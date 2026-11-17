const english=await fetch(new URL('./locales/en.json',import.meta.url)).then(r=>r.json());
export const normalize=value=>String(value??'en').toLowerCase().startsWith('zh')?'zh':'en';
let language=normalize(navigator.language);
export const getLanguage=()=>language;
export function t(key,...args){let value=language==='en'?(english[key]??key):key;args.forEach((a,i)=>value=value.replaceAll(`{${i}}`,a));return value;}
export function setLanguage(value){language=normalize(value);document.documentElement.lang=language==='zh'?'zh-CN':'en';
 const b=document.querySelector('#bubble');if(b){b.dataset.reply=language==='en'?'Click to reply':'点击回复';b.title=t('点击回复小鲸');}
}
setLanguage(language);
