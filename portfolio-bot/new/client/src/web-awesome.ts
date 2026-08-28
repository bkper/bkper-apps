import { registerIconLibrary } from '@awesome.me/webawesome';

// Components
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

registerIconLibrary('default', {
    resolver: name =>
        `https://cdn.jsdelivr.net/npm/@material-symbols/svg-400@latest/sharp/${name}.svg`,
    mutator: svg => svg.setAttribute('fill', 'currentColor'),
});
