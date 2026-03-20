const fs = require('fs');
const tpl = fs.readFileSync('views/werewolfBoard.ejs', 'utf8');
const matches = [...tpl.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
console.log('Found', matches.length, 'script blocks');
for (let i = 0; i < matches.length; i++) {
  let script = matches[i][1].trim();
  if (script.length < 50) continue;
  // Replace EJS expressions with dummy values for syntax checking
  script = script.replace(/<%-\s*([\s\S]*?)%>/g, '"__ejs__"'); // raw output
  script = script.replace(/<%=\s*([\s\S]*?)%>/g, '"__ejs__"'); // escaped output
  script = script.replace(/<%\s*([\s\S]*?)%>/g, '');           // control flow
  try {
    new Function(script);
    console.log('Block', i, '- OK (' + script.length + ' chars)');
  } catch(e) {
    console.log('Block', i, '- SYNTAX ERROR:', e.message, e.stack?.split('\n')[0]);
    // Write the processed script to a temp file for better error reporting
    fs.writeFileSync('/tmp/ww-check.js', script);
    const { execSync } = require('child_process');
    try {
      execSync('node --check /tmp/ww-check.js 2>&1', { encoding: 'utf8' });
    } catch (checkErr) {
      console.log(checkErr.stdout || checkErr.stderr || checkErr.message);
    }
  }
}
