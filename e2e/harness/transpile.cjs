// Webpack loads this CommonJS loader synchronously.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require('typescript');
module.exports = function(source) {
  const result = ts.transpileModule(source, {fileName:this.resourcePath, compilerOptions:{
    jsx:ts.JsxEmit.ReactJSX, module:ts.ModuleKind.ESNext, target:ts.ScriptTarget.ES2022,
    sourceMap:true, inlineSources:true,
  }});
  this.callback(null,result.outputText,JSON.parse(result.sourceMapText));
};
