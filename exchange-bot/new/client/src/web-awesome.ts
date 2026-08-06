import { registerIconLibrary } from '@awesome.me/webawesome';

// Themes
import '@awesome.me/webawesome/dist/styles/themes/default.css';

// Components
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';

registerIconLibrary('default', {
    resolver: name =>
        `https://cdn.jsdelivr.net/npm/@material-symbols/svg-400@latest/sharp/${name}.svg`,
    mutator: svg => svg.setAttribute('fill', 'currentColor'),
});
