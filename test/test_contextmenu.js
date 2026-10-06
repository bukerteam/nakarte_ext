import Contextmenu from '~/lib/contextmenu';

function showMenu(items) {
    new Contextmenu(items).show(new MouseEvent('contextmenu', {clientX: 10, clientY: 10}));
}

test('replaces an already open context menu', function () {
    showMenu([{text: 'first'}]);
    showMenu([{text: 'second'}]);
    const menus = document.querySelectorAll('.contextmenu');
    assert.equal(menus.length, 1);
    assert.include(menus[0].textContent, 'second');
    document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
    assert.equal(document.querySelectorAll('.contextmenu').length, 0);
});

test('marks and detects handled contextmenu events', function () {
    const contextMenuEvent = new MouseEvent('contextmenu');
    assert.isFalse(Contextmenu.isHandled(contextMenuEvent));
    assert.isFalse(Contextmenu.isHandled(null));
    Contextmenu.markHandled(contextMenuEvent);
    assert.isTrue(Contextmenu.isHandled(contextMenuEvent));
});
