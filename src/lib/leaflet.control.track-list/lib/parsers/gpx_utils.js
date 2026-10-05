import escapeHtml from 'escape-html';
import {decode as decodeUtf8, encode as encodeUtf8} from 'utf8';

import {xmlGetNodeText} from './xmlUtils';

/*
 * GPX point codec: parsing and serialization of wpt/trkpt/rtept data.
 *
 * Point metadata is stored in a plain `meta` object:
 * {name, desc, cmt, sym, type, time, ele, link, attributes, extensions, ...}.
 * Extension elements are kept as structures ({name, attributes, namespaces, children})
 * instead of serialized strings, so they can be written back without string manipulation.
 */

// Scalar elements of GPX wptType in the order defined by the GPX 1.1 schema.
// `ele` and `link` are handled separately, all other fields are simple text elements.
const POINT_FIELD_ORDER = [
    'ele',
    'time',
    'magvar',
    'geoidheight',
    'name',
    'cmt',
    'desc',
    'src',
    'link',
    'sym',
    'type',
    'fix',
    'sat',
    'hdop',
    'vdop',
    'pdop',
    'ageofdgpsdata',
    'dgpsid',
];

const POINT_TEXT_FIELDS = POINT_FIELD_ORDER.filter((field) => field !== 'ele' && field !== 'link');

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

const XML_ATTRIBUTE_NAME_RE = /^[^\s"'<>/=]+$/u;

function getElementsByLocalName(root, localName) {
    return root.getElementsByTagNameNS('*', localName);
}

function getChildElements(element) {
    return Array.prototype.slice.call(element.childNodes).filter((node) => node.nodeType === 1);
}

// Returns the element text without trimming it (leading and trailing spaces may be meaningful),
// or null if the element is missing or contains only whitespace
function getElementText(element) {
    const text = xmlGetNodeText(element);
    if (text === null || text.trim() === '') {
        return null;
    }
    return text;
}

// The application receives file contents as byte strings, so text fields have to be decoded
function decodeText(text) {
    if (text === null || text === undefined) {
        return text;
    }
    try {
        return decodeUtf8(text);
    } catch (e) {
        return text;
    }
}

// Encodes text back to a byte string and escapes characters that are not allowed in XML
function formatXmlText(value) {
    return encodeUtf8(escapeHtml(String(value)));
}

function getAmbientNamespace(element) {
    const doc = element.ownerDocument;
    return doc && doc.documentElement ? doc.documentElement.namespaceURI : null;
}

function parseXmlNode(element) {
    const ambientNamespace = getAmbientNamespace(element);
    const namespaces = {};
    if (element.namespaceURI && !(element.prefix === null && element.namespaceURI === ambientNamespace)) {
        namespaces[element.prefix || ''] = element.namespaceURI;
    }
    const attributes = {};
    for (const attribute of Array.from(element.attributes)) {
        if (attribute.name === 'xmlns' || attribute.prefix === 'xmlns') {
            continue;
        }
        attributes[attribute.name] = decodeText(attribute.value);
        if (attribute.namespaceURI && attribute.namespaceURI !== XML_NAMESPACE) {
            namespaces[attribute.prefix || ''] = attribute.namespaceURI;
        }
    }
    const children = [];
    for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 3 || child.nodeType === 4) {
            const text = decodeText(child.nodeValue);
            if (text.trim() !== '') {
                children.push(text);
            }
        } else if (child.nodeType === 1) {
            children.push(parseXmlNode(child));
        }
    }
    return {name: element.nodeName, attributes, namespaces, children};
}

function formatNamespaces(namespaces, inheritedNamespaces) {
    const declarations = [];
    for (const [prefix, uri] of Object.entries(namespaces).sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (inheritedNamespaces[prefix] === uri) {
            continue;
        }
        inheritedNamespaces[prefix] = uri;
        declarations.push(prefix ? `xmlns:${prefix}="${formatXmlText(uri)}"` : `xmlns="${formatXmlText(uri)}"`);
    }
    return declarations;
}

function serializeXmlNode(node, inheritedNamespaces = {}) {
    const namespaces = {...inheritedNamespaces};
    const declarations = formatNamespaces(node.namespaces, namespaces);
    const attributes = Object.entries(node.attributes)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([attributeName, value]) => `${attributeName}="${formatXmlText(value)}"`);
    const attributesString = [...declarations, ...attributes].join(' ');
    const openTag = `<${node.name}${attributesString ? ` ${attributesString}` : ''}`;
    if (!node.children.length) {
        return `${openTag}/>`;
    }
    const children = node.children
        .map((child) => (typeof child === 'string' ? formatXmlText(child) : serializeXmlNode(child, namespaces)))
        .join('');
    return `${openTag}>${children}</${node.name}>`;
}

function parseLinkElement(element) {
    const href = element.getAttribute('href');
    if (href === null) {
        return null;
    }
    const link = {href: decodeText(href)};
    const text = decodeText(getElementText(getElementsByLocalName(element, 'text')[0]));
    if (text !== null) {
        link.text = text;
    }
    const type = decodeText(getElementText(getElementsByLocalName(element, 'type')[0]));
    if (type !== null) {
        link.type = type;
    }
    return link;
}

function parsePointAttributes(pointElement) {
    const attributes = {};
    for (const attribute of Array.from(pointElement.attributes)) {
        if (attribute.name !== 'lat' && attribute.name !== 'lon' && XML_ATTRIBUTE_NAME_RE.test(attribute.name)) {
            attributes[attribute.name] = decodeText(attribute.value);
        }
    }
    return Object.keys(attributes).length ? attributes : null;
}

function parsePointChildElement(child, point, meta, extensions, storeName) {
    const tag = child.localName;
    if (tag === 'ele') {
        const eleText = getElementText(child);
        if (eleText !== null) {
            meta.ele = eleText;
            const eleValue = parseFloat(eleText);
            if (!isNaN(eleValue)) {
                point.alt = eleValue;
            }
        }
    } else if (tag === 'link') {
        const link = parseLinkElement(child);
        if (link) {
            meta.link = link;
        } else {
            // A link without href is not valid GPX, keep it as an extension
            extensions.push(parseXmlNode(child));
        }
    } else if (POINT_TEXT_FIELDS.includes(tag)) {
        // Waypoints keep the name in the legacy top-level field
        if (tag !== 'name' || storeName) {
            const text = decodeText(getElementText(child));
            if (text !== null) {
                meta[tag] = text;
            }
        }
    } else if (tag === 'extensions') {
        for (const extensionElement of getChildElements(child)) {
            extensions.push(parseXmlNode(extensionElement));
        }
    } else {
        // Unknown elements are kept as extensions to not lose data
        extensions.push(parseXmlNode(child));
    }
}

// Parses common properties of wpt, trkpt and rtept elements.
// Waypoints keep the name in the legacy top-level field, so storeName can be disabled for them.
function parsePointElement(pointElement, setError, storeName = true) {
    const lat = parseFloat(pointElement.getAttribute('lat'));
    const lng = parseFloat(pointElement.getAttribute('lon'));
    if (isNaN(lat) || isNaN(lng)) {
        setError();
        return null;
    }
    const point = {lat: lat, lng: lng};
    const meta = {};
    const extensions = [];
    for (const child of getChildElements(pointElement)) {
        parsePointChildElement(child, point, meta, extensions, storeName);
    }
    const attributes = parsePointAttributes(pointElement);
    if (attributes) {
        meta.attributes = attributes;
    }
    if (extensions.length) {
        meta.extensions = extensions;
    }
    if (Object.keys(meta).length) {
        point.meta = meta;
    }
    return point;
}

export {
    POINT_FIELD_ORDER,
    XML_ATTRIBUTE_NAME_RE,
    decodeText,
    formatXmlText,
    getElementsByLocalName,
    parsePointElement,
    serializeXmlNode,
};
