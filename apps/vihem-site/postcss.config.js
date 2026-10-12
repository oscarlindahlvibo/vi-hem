import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const appContainers={postcssPlugin:'demo-container-breakpoints',AtRule(rule){if(rule.name==='media'&&/^\(min-width:/.test(rule.params)&&rule.source.input.file?.endsWith('app-demo.css'))rule.name='container';}};
export default {plugins:[tailwindcss({config:'./tailwind.demo.config.js'}),appContainers,autoprefixer()]};
