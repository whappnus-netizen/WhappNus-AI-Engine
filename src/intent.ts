export interface IntentResult{intent:string;confidence:number}
const rules:Array<[string,RegExp[]]>=[
 ["greeting",[/\b(oi|olá|ola|bom dia|boa tarde|boa noite|hello|hey)\b/i]],
 ["pricing",[/\b(preço|preco|quanto custa|valor|plano|planos|custa)\b/i]],
 ["purchase",[/\b(comprar|compra|encomendar|pedido|pedir)\b/i]],
 ["support",[/\b(ajuda|problema|erro|não funciona|nao funciona|suporte)\b/i]],
 ["availability",[/\b(disponível|disponivel|stock|estoque|disponibilidade)\b/i]],
 ["location",[/\b(endereço|endereco|onde fica|localização|localizacao|morada)\b/i]]
];
export function classifyIntent(text:string):IntentResult{
 let best:IntentResult={intent:"general",confidence:0.35};
 for(const [intent,patterns] of rules){const hits=patterns.filter(p=>p.test(text)).length;if(hits){const c=Math.min(.95,.55+hits*.18);if(c>best.confidence)best={intent,confidence:c};}}
 return best;
}
