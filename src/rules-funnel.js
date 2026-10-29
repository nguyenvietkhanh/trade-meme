export class RulesFunnel{
 constructor(){this.hours=new Map();this.days=new Map();}
 restore(data){for(const [name,max]of [['hours',48],['days',14]])this[name]=new Map(Object.entries(data?.[name]??{}).slice(-max));}
 add(stage,at=Date.now(),reason=null){for(const [map,key,max]of [[this.hours,new Date(at).toISOString().slice(0,13),48],[this.days,new Date(at).toISOString().slice(0,10),14]]){const row=map.get(key)??{seen:0,pre_filter:0,safety:0,signal:0,quote:0,sent:0,reasons:{}};if(stage in row&&stage!=='reasons')row[stage]++;if(reason)row.reasons[reason]=(row.reasons[reason]??0)+1;map.set(key,row);while(map.size>max)map.delete(map.keys().next().value);}this.onChange?.(this.snapshot());}
 snapshot(){return {hours:Object.fromEntries(this.hours),days:Object.fromEntries(this.days),note:'Counters checkpointed with the existing live ledger; detailed evaluations in bounded research journal.'};}
}
