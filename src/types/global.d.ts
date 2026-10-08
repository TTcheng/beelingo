/**
 * Vite-specific module declarations.
 */

declare module '*.css?inline' {
  const css: string;
  export default css;
}