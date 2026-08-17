// Side-effect imports of stylesheets are preserved verbatim by tsc and
// resolved by Vite at bundle time.
declare module '*.css' {
  const url: string
  export default url
}
