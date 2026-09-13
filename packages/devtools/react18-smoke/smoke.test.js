/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-require-imports */

// Renders the BUILT panel (`../dist/index.js`) under React 18, the oldest
// React the devtools peer range allows. This project owns its own React 18
// copy (it is deliberately not a workspace; the root has React 19). The
// sources use nothing beyond React 18 (`useSyncExternalStore`,
// `createContext`), so what this guards is the bundle: `react/jsx-runtime`
// must stay external, otherwise webpack inlines the element factory of
// whichever React was installed at build time and a React 18 host rejects
// every element.
//
// The moduleNameMapper in package.json points every `react`/`react-dom`
// request — including the ones inside `../dist/index.js`, which would
// otherwise resolve upwards to the workspace React 19 — at this project's
// React 18, so the bundle and the renderer share one copy, as in a real host.
const { existsSync } = require('node:fs');
const path = require('node:path');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { initBroker, createClient, destroyBroker } = require('@hedwigjs/broker');

// React 18.3 exports `act` itself; 18.2 only has the test-utils one.
const act = React.act ?? require('react-dom/test-utils').act;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DIST = path.resolve(__dirname, '..', 'dist', 'index.js');

// Every mutation goes through here: the panel subscribes with
// useSyncExternalStore and the store notifies on broker events, so the
// event itself, plus a tick for anything batched, has to happen inside act.
const step = (fn) =>
  act(async () => {
    await fn();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

test(`the built panel renders and updates on React ${React.version}`, async () => {
  expect(React.version.startsWith('18.')).toBe(true);
  expect(existsSync(DIST)).toBe(true); // run `npm run build -w @hedwigjs/devtools` first
  const { MessageBrokerDevTools } = require(DIST);

  // A React 18 host must see a clean console: hook-order errors, element
  // type errors or un-acted updates all surface here. Collected instead of
  // printed, so a failure lists the messages rather than jest's code frame
  // of the whole minified bundle.
  const errors = [];
  const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.map(String).join(' ').slice(0, 300));
  });

  const broker = initBroker({ debug: true, history: { enabled: true } });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  try {
    await step(() => root.render(React.createElement(MessageBrokerDevTools, { broker, enabled: true })));
    const trigger = document.querySelector('button[aria-label*="devtools" i]');
    if (trigger) await step(() => trigger.click());
    expect(document.body.textContent).toContain('@hedwigjs/devtools');
    expect(document.body.textContent).toMatch(/messages/i);

    let a;
    await step(() => {
      a = createClient('a');
      createClient('b').on('t.v1', () => {});
    });
    await step(() => a.emit('t.v1', { n: 1 }));
    expect(document.body.textContent).toContain('t.v1');

    const tabs = Array.from(document.querySelectorAll('[role=tab]'));
    expect(tabs.length).toBeGreaterThanOrEqual(5);
    for (const tab of tabs) await step(() => tab.click());
  } finally {
    await step(() => root.unmount());
    el.remove();
    destroyBroker();
    errorSpy.mockRestore();
  }
  expect(errors).toEqual([]);
});
