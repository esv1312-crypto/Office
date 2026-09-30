const fs=require('fs');
const path=require('path');

class StateStore {
  constructor(options={}) {
    this.filePath=options.filePath||path.join(process.cwd(),'data','office-state.json');
    this.state=options.state||{version:1,updatedAt:null,projects:{},tasks:{},events:[]};
  }
  load(){
    if(!fs.existsSync(this.filePath)) return this.state;
    this.state=JSON.parse(fs.readFileSync(this.filePath,'utf8'));
    return this.state;
  }
  save(state=this.state){
    fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
    this.state={...state,updatedAt:new Date().toISOString()};
    const tmp=this.filePath+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(this.state,null,2));
    fs.renameSync(tmp,this.filePath);
    return this.state;
  }
  update(patch={}){ this.state={...this.state,...patch}; return this.save(); }
}
module.exports={StateStore};