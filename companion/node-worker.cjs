// One request, stdin/stdout only. No log files, screenshots on disk, retries, or listening sockets.
const {generate} = require('./model.cjs');
(async()=>{
  try {
    let size=0, chunks=[];
    for await (const chunk of process.stdin) { size+=chunk.length; if(size>3100000) throw Error('input_too_large'); chunks.push(chunk); }
    const {config,...data}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    process.stdout.write(JSON.stringify(await generate(data,config)));
  } catch(e) {
    const code = /^(invalid_|empty_message|input_too_large|model_)[a-z_0-9]*$/.test(e.message) ? e.message : 'local_configuration_or_input_error';
    process.stdout.write(JSON.stringify({ok:false,error:code}));
  }
})();
