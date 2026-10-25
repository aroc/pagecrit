import {mkdirSync, cpSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
mkdirSync('dist', {recursive:true});
rmSync('dist/pagecrit', {recursive:true,force:true});
cpSync('extension', 'dist/pagecrit', {recursive:true});
rmSync('dist/pagecrit.zip', {force:true});
// One top-level pagecrit/ folder, so unzipping always gives a folder to load unpacked.
execFileSync('python3', ['-m', 'zipfile', '-c', 'pagecrit.zip', 'pagecrit'], {cwd:'dist'});
console.log('Created dist/pagecrit.zip and dist/pagecrit/ (load unpacked).');
