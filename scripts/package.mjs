import {mkdirSync, cpSync, rmSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
mkdirSync('dist', {recursive:true});
rmSync('dist/page-notes', {recursive:true,force:true});
cpSync('extension', 'dist/page-notes', {recursive:true});
rmSync('dist/page-notes.zip', {force:true});
execFileSync('python3', ['-m', 'zipfile', '-c', '../page-notes.zip', ...readdirSync('dist/page-notes')], {cwd:'dist/page-notes'});
console.log('Created dist/page-notes.zip and dist/page-notes/ (load unpacked).');
