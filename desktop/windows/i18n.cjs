const fs=require('node:fs'),path=require('node:path');
const root=process.resourcesPath&&fs.existsSync(path.join(process.resourcesPath,'web/locales/en.json'))?path.join(process.resourcesPath,'web'):path.resolve(__dirname,'../../web');
const english=JSON.parse(fs.readFileSync(path.join(root,'locales/en.json'),'utf8'));
const normalize=value=>String(value??'en').toLowerCase().startsWith('zh')?'zh':'en';
let language='zh';
const t=(key,...args)=>{let value=language==='en'?(english[key]??key):key;args.forEach((a,i)=>value=value.replaceAll(`{${i}}`,a));return value;};
module.exports={t,normalize,english,setLanguage:value=>language=normalize(value),getLanguage:()=>language};
