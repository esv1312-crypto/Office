class EventBus {
  constructor(){this.listeners=new Map();}
  on(type,handler){if(!this.listeners.has(type)) this.listeners.set(type,new Set()); this.listeners.get(type).add(handler); return ()=>this.listeners.get(type)?.delete(handler);}
  emit(type,payload={}){const event={type,payload,at:new Date().toISOString()}; for(const fn of this.listeners.get(type)||[]) fn(event); return event;}
}
module.exports={EventBus};