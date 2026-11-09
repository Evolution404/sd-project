import ts from 'typescript';
import {parse} from '@vue/compiler-sfc';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';

const safeInputTypes=new Set(['text','password','textarea']);
const nativeTags=new Set(['button','input','select','option','optgroup','textarea','form','table','details','summary','datalist','dialog','progress','meter','a']);
const nativeDialogs=new Set(['alert','confirm','prompt']);
const kebab=name=>name.slice(2).replace(/[A-Z]/g,(c,i)=>(i?'-':'')+c.toLowerCase());
function propertyName(node){return ts.isPropertyAccessExpression(node)?node.name.text:ts.isElementAccessExpression(node)&&node.argumentExpression&&ts.isStringLiteralLike(node.argumentExpression)?node.argumentExpression.text:null}
function possibleStrings(node){
 if(!node)return null;
 if(ts.isStringLiteralLike(node))return [node.text];
 if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isNonNullExpression(node))return possibleStrings(node.expression);
 if(ts.isConditionalExpression(node)){const a=possibleStrings(node.whenTrue),b=possibleStrings(node.whenFalse);return a&&b?[...a,...b]:null}
 return null;
}
function expressionStrings(source){
 const ast=ts.createSourceFile('expression.ts','const value=('+source+');',ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 return possibleStrings(ast.statements[0]?.declarationList?.declarations[0]?.initializer);
}

// Extend the SFC tag audit to the ways a native widget can be hidden behind an
// Element Plus input, a render function, a browser API or missing widget CSS.
export function inspectUiContract(source,filename='component.vue',styles=''){
 const issues=[],imports=new Map(),components=new Set();
 const add=(rule,message,line)=>issues.push({file:filename,rule,message,...(line?{line}:{})});
 let descriptor;
 const scripts=[];
 if(filename.endsWith('.vue')){
  const parsed=parse(source,{filename});descriptor=parsed.descriptor;
  if(parsed.errors.length)throw Error(filename+' Vue解析失败');
  for(const block of [descriptor.script,descriptor.scriptSetup])if(block)scripts.push({content:block.content,offset:block.loc.start.line-1,lang:block.lang});
 }else scripts.push({content:source,offset:0,lang:filename.endsWith('x')?'tsx':'ts'});
 for(const script of scripts){
  const ast=ts.createSourceFile(filename,script.content,ts.ScriptTarget.Latest,true,script.lang==='tsx'?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const line=node=>ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1+script.offset;
  ast.forEachChild(node=>{
   if(!ts.isImportDeclaration(node))return;
   const library=node.moduleSpecifier.text;
   for(const item of node.importClause?.namedBindings?.elements||[]){
    const name=item.propertyName?.text||item.name.text;
    if(library==='element-plus'&&!node.importClause.isTypeOnly&&!item.isTypeOnly){imports.set(item.name.text,name);if(/^El[A-Z]/.test(name))components.add(name)}
    if(library==='vue'&&['h','createVNode','createElementVNode'].includes(name))imports.set(item.name.text,name);
   }
  });
  function visit(node){
   if(ts.isCallExpression(node)){
    const callee=node.expression,name=propertyName(callee);
    const base=ts.isPropertyAccessExpression(callee)||ts.isElementAccessExpression(callee)?callee.expression:null;
    if(ts.isIdentifier(callee)&&nativeDialogs.has(callee.text)||base&&['window','globalThis','self'].includes(base.getText(ast))&&nativeDialogs.has(name))add('native-browser-dialog','业务提示必须使用 ElMessageBox／ElMessage，禁止浏览器原生 '+(name||callee.getText(ast)),line(node));
    const renderName=ts.isIdentifier(callee)?imports.get(callee.text)||callee.text:name;
    const tags=['h','createVNode','createElementVNode'].includes(renderName)?possibleStrings(node.arguments[0]):name==='createElement'?possibleStrings(node.arguments[0]):name==='createElementNS'?possibleStrings(node.arguments[1]):[];
    for(const tag of tags||[])if(nativeTags.has(tag.toLowerCase())&&!(name==='createElement'&&tag==='a'))add('native-script-widget','禁止在脚本中创建原生业务控件 '+tag,line(node));
    if(name==='insertAdjacentHTML')add('raw-html-ui','禁止通过 HTML 字符串注入业务界面',line(node));
   }
   if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&['innerHTML','outerHTML'].includes(propertyName(node.left)))add('raw-html-ui','禁止通过 HTML 字符串注入业务界面',line(node));
   if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))if(nativeTags.has(node.tagName.getText(ast).toLowerCase()))add('native-script-widget','JSX中禁止原生业务控件',line(node));
   ts.forEachChild(node,visit);
  }
  visit(ast);
 }
 function visitTemplate(node){
  if(node.type===1){
   const component=imports.get(node.tag)||(/^el-/.test(node.tag)?'El'+node.tag.slice(3).split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join(''):node.tag);
   if(/^El[A-Z]/.test(component))components.add(component);
   const attribute=name=>node.props.find(p=>p.type===6&&p.name===name);
   const classes = attribute('class')?.value?.content?.split(/\s+/) || [];
   if (classes.includes('page-heading')) {
    const sections = node.children.filter(child =>
     child.type === 1 || child.type === 5 || child.type === 2 && child.content.trim()
    );
    if (sections.length > 2) {
     add('heading-sections', '页面标题只能有标题区和操作区，禁止把多个操作分散为独立布局项', node.loc.start.line);
    }
    for (const section of sections.slice(1)) {
     const sectionClasses = section.props
      ?.find(prop => prop.type === 6 && prop.name === 'class')
      ?.value?.content?.split(/\s+/) || [];
     if (!sectionClasses.includes('page-heading-actions') && !['ElTag', 'el-tag'].includes(section.tag)) {
      add('heading-action-group', '页面标题中的操作必须集中在page-heading-actions容器，由统一gap与换行规则布局', section.loc.start.line);
     }
    }
   }
   if(component==='ElForm'&&!attribute('novalidate'))add('native-form-validation','ElForm必须声明novalidate，错误由Element Plus字段校验展示',node.loc.start.line);
   if(component==='ElInput'){
    const type=node.props.find(p=>p.type===6&&p.name==='type'||p.type===7&&p.name==='bind'&&p.arg?.content==='type');
    const values=type?.type===6?[type.value?.content||'']:type?expressionStrings(type.exp?.content||''):['text'];
    if(!values||values.some(v=>!safeInputTypes.has(v)))add('native-input-type','ElInput仅允许text/password/textarea；日期使用ElDatePicker，数字使用ElInputNumber或text＋inputmode＋字段校验',type?.loc.start.line||node.loc.start.line);
    if(node.props.some(p=>p.type===7&&p.name==='bind'&&!p.arg))add('native-input-type','ElInput不允许通过未审计的v-bind透传原生type',node.loc.start.line);
   }
   for(const prop of node.props){
    if(prop.type===7&&prop.name==='html')add('raw-html-ui','禁止v-html绕过组件门禁',prop.loc.start.line);
    if(prop.type===7&&prop.name==='bind'&&prop.arg?.content==='is'||prop.type===6&&prop.name==='is'){
     const values=prop.type===6?[prop.value?.content||'']:expressionStrings(prop.exp?.content||'');
     if(values?.some(v=>nativeTags.has(v.toLowerCase())))add('native-dynamic-widget','禁止通过动态component渲染原生业务控件',prop.loc.start.line);
    }
   }
  }
  for(const child of node.children||[])visitTemplate(child);
 }
 if(descriptor?.template)visitTemplate(descriptor.template.ast);
 const styleAst=ts.createSourceFile('styles.ts',styles,ts.ScriptTarget.Latest,true),loaded=new Set();let allStyles=false;
 styleAst.forEachChild(node=>{if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){const path=node.moduleSpecifier.text;if(path==='element-plus/dist/index.css')allStyles=true;const match=path.match(/^element-plus\/es\/components\/([^/]+)\/style\/css$/);if(match)loaded.add(match[1])}});
 if(!allStyles)for(const component of components)if(!loaded.has(kebab(component)))add('missing-element-plus-style',component+'缺少统一样式导入：element-plus/es/components/'+kebab(component)+'/style/css');
 return issues;
}
export function currentUiContract(root){
 const base=join(root,'web','src'),styleFile=join(base,'styles','element-plus.ts');
 const styles=existsSync(styleFile)?readFileSync(styleFile,'utf8'):'';
 const walk=dir=>existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):/\.(vue|ts|tsx|js|jsx)$/.test(e.name)?[join(dir,e.name)]:[]):[];
 const issues=walk(base).flatMap(file=>inspectUiContract(readFileSync(file,'utf8'),relative(root,file).replaceAll('\\','/'),styles));
 const mainFile=join(base,'main.ts');
 if(existsSync(mainFile)){
  const main=ts.createSourceFile('main.ts',readFileSync(mainFile,'utf8'),ts.ScriptTarget.Latest,true);
  if(!main.statements.some(n=>ts.isImportDeclaration(n)&&/^\.\/styles\/element-plus(?:\.ts)?$/.test(n.moduleSpecifier.text)))issues.push({file:'web/src/main.ts',rule:'missing-style-entry',message:'应用入口必须导入统一Element Plus样式注册表'});
 }
 return issues;
}
