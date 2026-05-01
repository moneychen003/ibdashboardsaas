export function useT() {
  return (text, vars = {}) => {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\{(\w+)\}/g, (_, key) => (
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`
    ));
  };
}
