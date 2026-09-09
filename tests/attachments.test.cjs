const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
for(const [,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script);
new vm.Script(fs.readFileSync(__dirname+'/../service-worker.js','utf8'));
const elements=new Map();
function element(){return {children:[],style:{},dataset:{},classList:{add(){},remove(){}},appendChild(x){this.children.push(x);},setAttribute(){},remove(){this.removed=true;},textContent:'',innerHTML:''};}
const document={getElementById:id=>{if(!elements.has(id)) elements.set(id,element());return elements.get(id);},createElement:tag=>tag==='canvas'?{getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,/9j/'}:element()};
class Reader{readAsDataURL(file){Promise.resolve().then(()=>{if(file.fail)this.onerror();else this.onload({target:{result:'data:'+file.type+';base64,'+file.bytes.toString('base64')}});});}}
class ImageMock{set src(v){this.width=100;this.height=200;Promise.resolve().then(()=>this.onload());}}
const errors=[],requests=[],stored=[];let failOnce=false;
// 実際のGAS保存関数を呼び、Blobに渡されるバイト列・MIME・名前を検証する。
const gas={DriveApp:{getFolderById:id=>({createFile:blob=>{stored.push({id,...blob});return {getName:()=>blob.name,getUrl:()=> 'https://drive.google.com/file/d/test/view'};}})},Utilities:{base64Decode:s=>Array.from(Buffer.from(s,'base64')),newBlob:(bytes,mime,name)=>({bytes,mime,name})},Logger:{log(){}},buildResponse:x=>x};
vm.createContext(gas);const gs=fs.readFileSync(__dirname+'/../コード.gs','utf8');
vm.runInContext(gs.slice(gs.indexOf('function uploadImageToDrive('),gs.indexOf('// ── シート取得',gs.indexOf('function uploadImageToDrive('))),gas);
const c={document,FileReader:Reader,Image:ImageMock,URL,console,pageImages:{inline:[],add:[]},gasUrl:'https://example.test',currentFolderUrl:'https://drive.google.com/drive/folders/abcdefghijklmnopqrstuv',selectedFolderUrl:'https://drive.google.com/drive/folders/abcdefghijklmnopqrstuv',showError:(id,msg)=>errors.push(msg),clearError(){},showSuccess:(id,msg)=>{document.getElementById(id).textContent=msg;},clearSuccess(){},appLog(){},setTimeout:()=>0,clearTimeout(){},gasPost:async(url,body)=>{const data=JSON.parse(body);requests.push(data);if(failOnce){failOnce=false;throw Error('test network failure');}const result=gas.uploadImageToDrive(data);return {text:async()=>JSON.stringify(result)};}};
vm.createContext(c);vm.runInContext(html.slice(html.indexOf('  const MAX_PAGE_IMAGES'),html.indexOf('  // ── 登録後に画像追加')),c);
function file(name,type,content){const bytes=Buffer.from(content);return {name,type,bytes,size:bytes.length,slice:(a,b)=>({text:async()=>bytes.subarray(a,b).toString()})};}
async function test(){
 const pdf=file('読書メモ.pdf','','%PDF-1.4\noriginal bytes\n%%EOF');
 await c.addPageFiles([pdf,file('photo.png','image/png','png')],'add');
 assert.equal(c.pageImages.add.length,2);assert.equal(c.pageImages.add[0].mime,'application/pdf');
 assert.equal(c.pageImages.add[0].name,'読書メモ.pdf');assert.match(c.pageImages.add[0].thumb.textContent,/読書メモ.pdf/);
 await c.uploadPageImages('add');
 assert.equal(requests[0].action,'uploadImage');assert.equal(stored[0].mime,'application/pdf');assert.equal(stored[0].name,'読書メモ.pdf');assert.deepEqual(Buffer.from(stored[0].bytes),pdf.bytes);
 assert.equal(stored[1].mime,'image/jpeg');assert.match(stored[1].name,/\.jpg$/);assert.equal(c.pageImages.add.length,0);
 assert.equal(document.getElementById('addSuccessBox').children[0].href,'https://drive.google.com/file/d/test/view');
 await c.addPageFiles([file('bad.pdf','application/pdf','not pdf'),file('bad.txt','text/plain','x'),{...pdf,size:21*1024*1024}, {...pdf,size:0}],'inline');assert.equal(c.pageImages.inline.length,0);assert(errors.length);
 await c.addPageFiles([file('スキャン','application/pdf','%PDF-1.7\n%%EOF')],'inline');assert.equal(c.pageImages.inline[0].name,'スキャン.pdf');
 failOnce=true;await c.uploadPageImages('inline');assert.equal(c.pageImages.inline.length,1);await c.uploadPageImages('inline');assert.equal(c.pageImages.inline.length,0);
 await c.addPageFiles([pdf,pdf],'inline');const failedThumb=c.pageImages.inline[0].thumb;const savedThumb=c.pageImages.inline[1].thumb;
 failOnce=true;await c.uploadPageImages('inline');assert.equal(c.pageImages.inline.length,1);assert.equal(c.pageImages.inline[0].thumb,failedThumb);assert.equal(savedThumb.removed,true);assert.equal(failedThumb.removed,undefined);
 const beforeRetry=stored.length;await c.uploadPageImages('inline');assert.equal(stored.length,beforeRetry+1);assert.equal(c.pageImages.inline.length,0);
 await c.addPageFiles(Array.from({length:21},()=>pdf),'add');assert.equal(c.pageImages.add.length,20);
 c.pageImages.add=[];await c.addPageFiles(Array.from({length:3},()=>({...pdf,size:20*1024*1024})),'add');assert.equal(c.pageImages.add.length,2);
 c.pageImages.add=[];await c.addPageFiles([{...pdf,fail:true}],'add');assert.equal(c.pageImages.add.length,0);
 const pending=c.addPageFiles([pdf],'add');await c.uploadPageImages('add');await pending;assert.equal(c.pageImages.add.length,1);
 const thumb=c.pageImages.add[0].thumb;thumb.children.at(-1).onclick();assert.equal(c.pageImages.add.length,0);
 assert.match(html,/id="inlinePageInput" accept="image\/\*,application\/pdf,\.pdf"/);assert.match(html,/id="addPageInput" accept="image\/\*,application\/pdf,\.pdf"/);assert.match(html,/id="fileInput" accept="image\/\*"/);
 console.log('PASS: syntax, PDF original bytes/MIME/Japanese name through actual GAS handler, image compatibility, saved links, both pickers, invalid/empty/large files, retry, count/total limits, reading lock, remove');
}
test().catch(error=>{console.error(error);process.exitCode=1;});
