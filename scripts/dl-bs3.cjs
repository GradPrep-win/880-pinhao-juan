const https=require("https");
const http=require("http");
const fs=require("fs");
const path=require("path");
const {execSync}=require("child_process");
const pkgVer=require(path.join(__dirname,"..","node_modules/better-sqlite3/package.json")).version;
const abi=133;
const url=`https://github.com/WiseLibs/better-sqlite3/releases/download/v${pkgVer}/better-sqlite3-v${pkgVer}-electron-v${abi}-win32-x64.tar.gz`;
const tmpZip=path.join(require("os").tmpdir(),`bs3-${pkgVer}-${abi}.tar.gz`);
const tmpDir=path.join(require("os").tmpdir(),`bs3-ext-${process.pid}`);

function download(url,dest){
  return new Promise((resolve,reject)=>{
    const file=fs.createWriteStream(dest);
    const mod=url.startsWith("https")?https:http;
    mod.get(url,{headers:{"User-Agent":"gradprep"}},res=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location)
        return download(res.headers.location,dest).then(resolve,reject);
      if(res.statusCode!==200) return reject(new Error("HTTP "+res.statusCode));
      res.pipe(file);
      file.on("finish",()=>file.close(resolve));
    }).on("error",reject);
  });
}

(async()=>{
  try{
    console.log("downloading",url);
    await download(url,tmpZip);
    console.log("downloaded",fs.statSync(tmpZip).size,"bytes");
    fs.mkdirSync(tmpDir,{recursive:true});
    const extractScript=path.join(__dirname,"extract-tar.cjs");
    execSync(`node "${extractScript}" "${tmpZip}" "${tmpDir}"`,{stdio:"pipe"});
    let built=path.join(tmpDir,"build/Release/better_sqlite3.node");
    if(!fs.existsSync(built)) built=path.join(tmpDir,"better_sqlite3.node");
    if(!fs.existsSync(built)){console.log("no .node found in",tmpDir);process.exit(1);}
    const target=path.join(__dirname,"..","node_modules/better-sqlite3/build/Release");
    fs.copyFileSync(built,path.join(target,"better_sqlite3.node"));
    fs.writeFileSync(path.join(target,"".concat(".forge-meta")),`x64--${abi}`);
    console.log("OK - replaced with ABI",abi);
    console.log("size:",fs.statSync(path.join(target,"better_sqlite3.node")).size);
  }catch(e){ console.error("FAIL:",e.message);process.exit(1); }
})();
