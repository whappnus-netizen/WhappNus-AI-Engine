const buckets=new Map<string,{count:number;reset:number}>();
export function allow(key:string,limit:number){const n=Date.now(),b=buckets.get(key);if(!b||n>=b.reset){buckets.set(key,{count:1,reset:n+60000});return true;}if(b.count>=limit)return false;b.count++;return true;}
