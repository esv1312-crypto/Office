class EventStore {
  constructor(options={}){this.stateStore=options.stateStore||null; this.events=[];}
  load(){const state=this.stateStore?.load(); this.events=Array.isArray(state?.events)?state.events:[]; return this.events;}
  append(event){this.events.push(event); if(this.stateStore) this.stateStore.update({events:this.events}); return event;}
  list(){return [...this.events];}
}
module.exports={EventStore};