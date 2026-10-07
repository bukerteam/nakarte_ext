const language = ((navigator.languages && navigator.languages[0]) || navigator.language || 'en').toLowerCase();
const isRussian = language.startsWith('ru');

function t(ru, en) {
    return isRussian ? ru : en;
}

export {t};
