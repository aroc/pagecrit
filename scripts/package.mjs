import {mkdirSync, cpSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
mkdirSync('dist', {recursive:true});
rmSync('dist/page-notes', {recursive:true,force:true});
cpSync('extension', 'dist/page-notes', {recursive:true});
rmSync('dist/page-notes.zip', {force:true});
// One top-level page-notes/ folder, so unzipping always gives a folder to load unpacked.
execFileSync('python3', ['-m', 'zipfile', '-c', 'page-notes.zip', 'page-notes'], {cwd:'dist'});
console.log('Created dist/page-notes.zip and dist/page-notes/ (load unpacked).');
