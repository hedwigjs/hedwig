import './styles/reset.css';
import './styles/layout.css';

import { renderChrome } from './chrome/renderChrome';
import { registerMicrofrontends } from './registerMicrofrontends';

async function main() {
  renderChrome();
  await registerMicrofrontends();
}

void main();
