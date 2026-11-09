import { Window } from 'happy-dom';

const browserWindow = new Window({ url: 'http://localhost:5207/' });

if (!('attachInternals' in browserWindow.HTMLElement.prototype)) {
    Object.defineProperty(browserWindow.HTMLElement.prototype, 'attachInternals', {
        configurable: true,
        value: () => ({
            ariaLabel: null,
            checkValidity: () => true,
            form: null,
            labels: [],
            reportValidity: () => true,
            role: null,
            setFormValue: () => undefined,
            setValidity: () => undefined,
            states: new Set<string>(),
            validationMessage: '',
            validity: { valid: true },
            willValidate: true,
        }),
    });
}

// happy-dom runs no animations; Web Awesome's menus wait for theirs to finish opening or closing.
if (!('getAnimations' in browserWindow.Element.prototype)) {
    Object.defineProperty(browserWindow.Element.prototype, 'getAnimations', {
        configurable: true,
        value: () => [],
    });
}

const browserGlobals = [
    ['window', browserWindow],
    ['document', browserWindow.document],
    ['customElements', browserWindow.customElements],
    ['HTMLElement', browserWindow.HTMLElement],
    ['Element', browserWindow.Element],
    ['Node', browserWindow.Node],
    ['Document', browserWindow.Document],
    ['Event', browserWindow.Event],
    ['EventTarget', browserWindow.EventTarget],
    ['CustomEvent', browserWindow.CustomEvent],
    ['KeyboardEvent', browserWindow.KeyboardEvent],
    ['InputEvent', browserWindow.InputEvent],
    ['FocusEvent', browserWindow.FocusEvent],
    ['MouseEvent', browserWindow.MouseEvent],
    ['HTMLAnchorElement', browserWindow.HTMLAnchorElement],
    ['HTMLSlotElement', browserWindow.HTMLSlotElement],
    ['MessageEvent', browserWindow.MessageEvent],
    ['ShadowRoot', browserWindow.ShadowRoot],
    ['CSSStyleSheet', browserWindow.CSSStyleSheet],
    ['MutationObserver', browserWindow.MutationObserver],
    ['ResizeObserver', browserWindow.ResizeObserver],
    ['DOMParser', browserWindow.DOMParser],
    ['requestAnimationFrame', browserWindow.requestAnimationFrame.bind(browserWindow)],
    ['cancelAnimationFrame', browserWindow.cancelAnimationFrame.bind(browserWindow)],
    ['getComputedStyle', browserWindow.getComputedStyle.bind(browserWindow)],
] as const;

for (const [name, value] of browserGlobals) {
    Object.defineProperty(globalThis, name, {
        configurable: true,
        value,
    });
}
