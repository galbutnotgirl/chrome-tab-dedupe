// Screenshot-only stub of the chrome.* APIs the settings page calls.
// `chrome` is non-configurable on a plain web page, so patch namespaces onto it.
const stub = {
  storage: {
    sync: { get: async (defaults) => defaults, set: async () => {} },
    session: { get: async () => ({}) },
  },
  runtime: { sendMessage: async () => ({ count: 4, groups: [] }), openOptionsPage() {} },
  tabs: { create() {} },
  windows: { getCurrent: async () => ({ id: 1 }) },
};
for (const [key, value] of Object.entries(stub)) {
  Object.defineProperty(globalThis.chrome, key, { configurable: true, writable: true, value });
}
