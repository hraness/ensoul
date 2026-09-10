import { describe, test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assetNames, compareVersions, digest, parseManifest, releaseBody,
  verifyAttestationResult, verifyAttempt, verifyFiles, verifyReleaseRecord, type Manifest,
} from "../scripts/github-release.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soulscrape-canonical-test-"));
  const dir = join(root, "assets"); mkdirSync(dir);
  const archive = Buffer.from("exact tested source archive fixture");
  const m: Manifest = {schema:"hraness-github-release-v1",repository:"hraness/soulscrape",repositoryId:1350294135,package:"@hraness/soulscrape",version:"0.3.3",tag:"v0.3.3",sourceSha:"a".repeat(40),workflow:".github/workflows/release.yml",workflowSha:"b".repeat(40),runId:12345,runAttempt:1,archive:{name:"hraness-soulscrape-0.3.3.tgz",bytes:archive.length,sha256:digest(archive),sha512:digest(archive,"sha512")}};
  writeFileSync(join(dir,m.archive.name),archive);
  writeFileSync(join(dir,"npm-pack.json"),JSON.stringify([{name:m.package,version:m.version,filename:m.archive.name,size:archive.length,shasum:digest(archive,"sha1"),integrity:`sha512-${createHash("sha512").update(archive).digest("base64")}`}])+"\n");
  writeFileSync(join(dir,"release-manifest.json"),JSON.stringify(m)+"\n");
  writeFileSync(join(dir,"SHA256SUMS"),assetNames(m).slice(0,3).map(name=>`${digest(readFileSync(join(dir,name)))}  ${name}\n`).join(""));
  writeFileSync(join(dir,"provenance.jsonl"),'{"fixture":"verified only by mocked gh"}\n');
  const subjects=Object.fromEntries(assetNames(m).slice(0,4).map(name=>[name,digest(readFileSync(join(dir,name)))]));
  const workflowUri=`https://github.com/${m.repository}/${m.workflow}@refs/tags/${m.tag}`;
  const certificate={buildConfigURI:workflowUri,buildSignerURI:workflowUri,issuer:"https://token.actions.githubusercontent.com",runnerEnvironment:"github-hosted",sourceRepositoryURI:"https://github.com/hraness/soulscrape",sourceRepositoryIdentifier:String(m.repositoryId),sourceRepositoryDigest:m.sourceSha,sourceRepositoryRef:`refs/tags/${m.tag}`,buildSignerDigest:m.sourceSha,buildConfigDigest:m.sourceSha,buildTrigger:"push",runInvocationURI:`https://github.com/hraness/soulscrape/actions/runs/${m.runId}/attempts/${m.runAttempt}`};
  const verified=[{verificationResult:{signature:{certificate},statement:{_type:"https://in-toto.io/Statement/v1",predicateType:"https://slsa.dev/provenance/v1",predicate:{buildDefinition:{buildType:"https://actions.github.io/buildtypes/workflow/v1",externalParameters:{workflow:{repository:`https://github.com/${m.repository}`,path:m.workflow,ref:`refs/tags/${m.tag}`}},internalParameters:{github:{repository_id:m.repositoryId,repository_owner_id:307125679,event_name:"push",runner_environment:"github-hosted"}},resolvedDependencies:[{uri:`git+https://github.com/${m.repository}@refs/tags/${m.tag}`,digest:{gitCommit:m.sourceSha}}]},runDetails:{builder:{id:workflowUri},metadata:{invocationId:`https://github.com/${m.repository}/actions/runs/${m.runId}/attempts/${m.runAttempt}`}}},subject:Object.entries(subjects).map(([name,sha256])=>({name,digest:{sha256}}))}}}];
  const attempt={id:m.runId,run_attempt:m.runAttempt,workflow_id:345387950,name:"release",path:m.workflow,event:"push",head_branch:m.tag,head_sha:m.sourceSha,status:"in_progress",conclusion:null,actor:{id:894119,type:"User"},triggering_actor:{id:894119,type:"User"},repository:{id:m.repositoryId,full_name:m.repository,private:false}};
  const assets=assetNames(m).map((name,i)=>({id:100+i,name,state:"uploaded",size:readFileSync(join(dir,name)).length,digest:`sha256:${digest(readFileSync(join(dir,name)))}`}));
  const release={id:77,tag_name:m.tag,name:`Soulscrape ${m.tag}`,body:releaseBody(m),target_commitish:m.sourceSha,prerelease:false,draft:false,immutable:true,author:{id:41898282,login:"github-actions[bot]",type:"Bot"},assets};
  return {root,dir,m,subjects,verified,attempt,release,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

describe("canonical release evidence",()=>{
  test("binds archive, receipt, exact files and strict bounded identity",()=>{
    const f=fixture(); try {
      expect(verifyFiles(f.dir)).toEqual(f.m);
      for(const change of [{repositoryId:1350294136},{tag:"v0.3.4"},{runAttempt:0},{runId:Number.MAX_SAFE_INTEGER+1},{version:"0.03.3"},{sourceSha:"../../escape"},{extra:true},{archive:{...f.m.archive,name:"../archive.tgz"}}]) expect(()=>parseManifest({...f.m,...change})).toThrow();
      expect(compareVersions("0.3.4","0.3.3")).toBe(1);
      expect(()=>compareVersions("0.3.3-beta","0.3.3")).toThrow();
      writeFileSync(join(f.dir,"extra.txt"),"unreviewed");
      expect(()=>verifyFiles(f.dir)).toThrow("Unexpected release files");
      rmSync(join(f.dir,"extra.txt"));
      writeFileSync(join(f.dir,f.m.archive.name),"replacement");
      expect(()=>verifyFiles(f.dir)).toThrow("Archive digest mismatch");
    } finally {f.cleanup();}
  });
  test("rejects symlinks and modified pack receipt despite matching archive",()=>{
    const f=fixture(); try {
      const receipt=join(f.dir,"npm-pack.json"); const original=readFileSync(receipt);
      rmSync(receipt);writeFileSync(join(f.root,"receipt.json"),original);symlinkSync(join(f.root,"receipt.json"),receipt);
      expect(()=>verifyFiles(f.dir)).toThrow("Unsafe asset type");
      rmSync(receipt);writeFileSync(receipt,JSON.stringify([{name:f.m.package,version:"0.3.4"}]));
      expect(()=>verifyFiles(f.dir)).toThrow("Pack receipt mismatch");
    } finally {f.cleanup();}
  });
  test("binds verified certificate to hosted repository source and exact run attempt",()=>{
    const f=fixture();try {
      expect(()=>verifyAttestationResult(f.verified,f.m,f.subjects)).not.toThrow();
      for(const field of ["buildConfigURI","buildSignerURI","issuer","runnerEnvironment","sourceRepositoryURI","sourceRepositoryIdentifier","sourceRepositoryDigest","sourceRepositoryRef","buildSignerDigest","buildConfigDigest","buildTrigger","runInvocationURI"]){
        const bad=structuredClone(f.verified);(bad[0]!.verificationResult.signature.certificate as Record<string,string>)[field]="wrong";
        expect(()=>verifyAttestationResult(bad,f.m,f.subjects)).toThrow("certificate");
      }
      for (const mutate of [
        (p: any)=>{p.buildDefinition.buildType="other";},
        (p: any)=>{p.buildDefinition.externalParameters.workflow.ref="refs/heads/main";},
        (p: any)=>{p.buildDefinition.internalParameters.github.repository_owner_id=1;},
        (p: any)=>{p.buildDefinition.resolvedDependencies[0].digest.gitCommit="e".repeat(40);},
        (p: any)=>{p.runDetails.builder.id="other";},
        (p: any)=>{p.runDetails.metadata.invocationId="other";},
      ]) {
        const bad=structuredClone(f.verified);mutate(bad[0]!.verificationResult.statement.predicate);
        expect(()=>verifyAttestationResult(bad,f.m,f.subjects)).toThrow();
      }
      const duplicate=structuredClone(f.verified);duplicate[0]!.verificationResult.statement.subject[1]=duplicate[0]!.verificationResult.statement.subject[0]!;
      expect(()=>verifyAttestationResult(duplicate,f.m,f.subjects)).toThrow("subject mismatch");
      const unsigned=structuredClone(f.verified);unsigned[0]!.verificationResult.statement.subject[0]!.digest.sha256="e".repeat(64);
      expect(()=>verifyAttestationResult(unsigned,f.m,f.subjects)).toThrow("subject mismatch");
      expect(()=>verifyAttestationResult([...f.verified,...f.verified],f.m,f.subjects)).toThrow("one verified");
    } finally {f.cleanup();}
  });
  test("rejects collaborator reruns and unfinished mirror source attempts",()=>{
    const f=fixture();try {
      expect(()=>verifyAttempt(f.attempt,f.m,true)).not.toThrow();
      expect(()=>verifyAttempt({...f.attempt,triggering_actor:{id:99,type:"User"}},f.m,true)).toThrow("owner-authorized");
      expect(()=>verifyAttempt(f.attempt,f.m,false)).toThrow("required state");
      expect(()=>verifyAttempt({...f.attempt,status:"completed",conclusion:"success"},f.m,false)).not.toThrow();
    } finally {f.cleanup();}
  });
  test("requires exact immutable provider record and reconciles only matching draft assets",()=>{
    const f=fixture();try {
      expect(()=>verifyReleaseRecord(f.release,f.m,f.dir,false)).not.toThrow();
      expect(()=>verifyReleaseRecord({...f.release,draft:true,immutable:false,assets:f.release.assets.slice(0,1)},f.m,f.dir,true)).not.toThrow();
      for(const patch of [{author:{id:894119,type:"User"}},{body:"other run"},{target_commitish:"c".repeat(40)},{immutable:false},{assets:f.release.assets.slice(0,4)},{assets:[...f.release.assets.slice(0,4),f.release.assets[0]]}]) expect(()=>verifyReleaseRecord({...f.release,...patch},f.m,f.dir,false)).toThrow();
      expect(()=>verifyReleaseRecord({...f.release,assets:f.release.assets.map(a=>({...a,digest:"sha256:"+"e".repeat(64)}))},f.m,f.dir,false)).toThrow("digest differs");
    } finally {f.cleanup();}
  });
});

function installProviderMock(f: ReturnType<typeof fixture>) {
  const bin=join(f.root,"bin");mkdirSync(bin);
  writeFileSync(join(f.root,"fixture.json"),JSON.stringify({manifest:f.m,verified:f.verified,attempt:f.attempt,release:f.release}));
  writeFileSync(join(bin,"gh"),`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const root=process.env.MOCK_ROOT,f=JSON.parse(fs.readFileSync(path.join(root,'fixture.json'),'utf8')),args=process.argv.slice(2),state=path.join(root,'release.json');
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(args)+'\\n');
const fail=(s)=>{process.stderr.write(s+'\\n');process.exit(1)};
const output=v=>process.stdout.write(JSON.stringify(v));
const read=()=>JSON.parse(fs.readFileSync(state,'utf8'));
const save=v=>fs.writeFileSync(state,JSON.stringify(v));
if(args[0]==='attestation'){
  for(const [flag,value] of [['--repo',f.manifest.repository],['--signer-workflow',f.manifest.repository+'/'+f.manifest.workflow],['--signer-digest',f.manifest.sourceSha],['--source-digest',f.manifest.sourceSha],['--source-ref','refs/tags/'+f.manifest.tag],['--bundle',path.join(path.dirname(args[2]),'provenance.jsonl')],['--format','json']]) if(args[args.indexOf(flag)+1]!==value) fail('Missing exact verification flag '+flag);
  if(!args.includes('--deny-self-hosted-runners')||process.env.MOCK_PROVENANCE_FAILURE==='true') fail('Provenance verification failed');
  output(f.verified);
}else if(args[0]==='api'){
  const endpoint=args.find(a=>a.startsWith('/repos/hraness/soulscrape'));
  if(endpoint==='/repos/hraness/soulscrape/releases'&&args.includes('POST')){
    if(fs.existsSync(state))fail('Draft must not be recreated');
    const field=name=>args.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
    if(field('draft')!=='true'||field('prerelease')!=='false')fail('Invalid draft create');
    const release={...f.release,tag_name:field('tag_name'),target_commitish:field('target_commitish'),name:field('name'),body:field('body'),draft:true,immutable:false,assets:[]};save(release);output(release);
  }
  else if(endpoint.endsWith('/releases/tags/v0.3.3')){if(process.env.MOCK_LOOKUP_403==='true')fail('gh: Forbidden (HTTP 403)');if(!fs.existsSync(state)||read().draft)fail('gh: Not Found (HTTP 404)');output(read());}
  else if(endpoint.includes('/releases?per_page=100&page=')){
    if(process.env.MOCK_LOOKUP_403==='true')fail('gh: Forbidden (HTTP 403)');
    const page=Number(endpoint.split('page=').at(-1));
    const current=fs.existsSync(state)?read():null;
    if(process.env.MOCK_DUPLICATE_DRAFT==='true'&&current)output([current,{...current,id:current.id+1}]);
    else if(process.env.MOCK_RELEASE_PAGE==='2'&&page===1)output(Array.from({length:100},(_,i)=>({id:1000+i,tag_name:'unrelated-'+i})));
    else output(current&&process.env.MOCK_POST_CREATE_HIDDEN!=='true'?[current]:[]);
  }
  else if(endpoint==='/repos/hraness/soulscrape/releases/77'){const release=read();output(process.env.MOCK_RELEASE_ID_DRIFT==='true'?{...release,id:78}:release);}
  else if(endpoint.endsWith('/releases/latest'))output(fs.existsSync(state)&&read().draft===false?read():{id:66,tag_name:process.env.MOCK_LATEST||'v0.3.2',draft:false,prerelease:false,immutable:true});
  else if(endpoint.includes('/releases/assets/')){const id=Number(endpoint.split('/').at(-1));const a=read().assets.find(a=>a.id===id);process.stdout.write(fs.readFileSync(path.join(root,'assets',a.name)));}
  else if(endpoint.endsWith('/attempts/1'))output(f.attempt);
  else if(endpoint.endsWith('/actions/workflows/345387950'))output({id:345387950,name:'release',path:f.manifest.workflow,state:'active'});
  else if(endpoint.endsWith('/git/ref/tags/v0.3.3'))output({object:{type:'tag',sha:'d'.repeat(40)}});
  else if(endpoint.includes('/git/tags/'))output({object:{type:'commit',sha:process.env.MOCK_MOVED_TAG==='true'?'e'.repeat(40):f.manifest.sourceSha}});
  else if(endpoint.endsWith('/commits/main'))output({sha:f.manifest.workflowSha});
  else if(endpoint.includes('/compare/'))output({status:process.env.MOCK_UNREACHABLE_SOURCE==='true'?'diverged':'ahead'});
  else if(endpoint==='/repos/hraness/soulscrape')output({id:f.manifest.repositoryId,full_name:f.manifest.repository,private:false,visibility:'public',default_branch:'main'});
  else fail('Unexpected API '+endpoint);
}else if(args[0]==='release'){
  if(args.includes('--clobber')||args.includes('delete'))fail('Destructive operation');
  if(args[1]==='download'){
    const destination=args[args.indexOf('--dir')+1];for(const name of fs.readdirSync(path.join(root,'assets')))fs.copyFileSync(path.join(root,'assets',name),path.join(destination,name));
  }else if(args[1]==='create'){
    if(fs.existsSync(state)||!args.includes('--draft')||!args.includes('--verify-tag'))fail('Invalid create');
    save({...f.release,draft:true,immutable:false,assets:[]});
  }else if(args[1]==='upload'){
    const release=read(),name=path.basename(args[3]);
    if(release.assets.some(a=>a.name===name))fail('Asset overwrite');
    release.assets.push(f.release.assets.find(a=>a.name===name));save(release);
  }else if(args[1]==='edit'){
    const release=read();if(release.assets.length!==5||!args.includes('--draft=false')||!args.includes('--latest'))fail('Premature publish');
    save({...release,draft:false,immutable:true});
  }else fail('Unexpected release operation');
}else fail('Unexpected gh call');
`);
  writeFileSync(join(bin,"git"),`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),f=JSON.parse(fs.readFileSync(path.join(process.env.MOCK_ROOT,'fixture.json'),'utf8')),args=process.argv.slice(2);
if(args[0]==='fetch'){}else if(args[0]==='rev-parse')process.stdout.write(f.manifest.workflowSha);else if(args[0]==='merge-base'){}else if(args[0]==='diff'){if(process.env.MOCK_CONTROL_DRIFT==='true')process.exit(1);}else if(args[0]==='ls-remote')process.stdout.write(f.manifest.sourceSha+'\\trefs/tags/'+f.manifest.tag+'\\n');else process.exit(2);
`);
  chmodSync(join(bin,"gh"),0o755);chmodSync(join(bin,"git"),0o755);
  const environment={...process.env,PATH:`${bin}:${process.env.PATH}`,MOCK_ROOT:f.root,VERIFIED_SOURCE_SHA:f.m.sourceSha,WORKFLOW_SHA:f.m.workflowSha,VERIFIED_TAG:f.m.tag,GITHUB_RUN_ID:String(f.m.runId),GITHUB_RUN_ATTEMPT:String(f.m.runAttempt),GITHUB_REPOSITORY:f.m.repository,GITHUB_REPOSITORY_ID:String(f.m.repositoryId),GITHUB_SHA:f.m.sourceSha,GITHUB_REF:`refs/tags/${f.m.tag}`,GITHUB_EVENT_NAME:"push",IMMUTABLE_RELEASES_ENABLED:"true",EXPECTED_ARCHIVE_SHA256:f.subjects[f.m.archive.name]!,EXPECTED_PACK_SHA256:f.subjects["npm-pack.json"]!,EXPECTED_MANIFEST_SHA256:f.subjects["release-manifest.json"]!,EXPECTED_SUMS_SHA256:f.subjects["SHA256SUMS"]!,EXPECTED_PROVENANCE_SHA256:digest(readFileSync(join(f.dir,"provenance.jsonl")))};
  const run=(extra:Record<string,string>={})=>Bun.spawnSync({cmd:[process.execPath,join(import.meta.dir,"../scripts/github-release.ts"),"publish",f.dir],env:{...environment,...extra},stdout:"pipe",stderr:"pipe"});
  const calls=()=>readFileSync(join(f.root,"calls.jsonl"),"utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line) as string[]);
  const mirror=(directory:string,extra:Record<string,string>={})=>Bun.spawnSync({cmd:[process.execPath,join(import.meta.dir,"../scripts/github-release.ts"),"mirror",directory],env:{...environment,GITHUB_SHA:f.m.workflowSha,GITHUB_REF:"refs/heads/main",EXPECTED_SOURCE_SHA:f.m.sourceSha,EXPECTED_WORKFLOW_SHA:f.m.workflowSha,EXPECTED_VERSION:f.m.version,...extra},stdout:"pipe",stderr:"pipe"});
  return {run,mirror,calls,state:join(f.root,"release.json"),log:join(f.root,"calls.jsonl")};
}

function mutations(calls: string[][]): string[][] {
  return calls.filter(c=>c[0]==="release" || (c[0]==="api" && c[2]==="POST"));
}
describe("canonical publication provider boundary",()=>{
  test("creates a draft, uploads exact bytes, verifies readback and makes immutable Latest",()=>{
    const f=fixture();try {
      const mock=installProviderMock(f);const result=mock.run({MOCK_POST_CREATE_HIDDEN:"true"});
      expect(result.stderr.toString()).toBe("");expect(result.exitCode).toBe(0);
      const writes=mutations(mock.calls());
      expect(writes.map(c=>c[0]==="api"?"create":c[1])).toEqual(["create",...Array(5).fill("upload"),"edit"]);
      verifyReleaseRecord(JSON.parse(readFileSync(mock.state,"utf8")),f.m,f.dir,false);
      writeFileSync(mock.log,"");expect(mock.run().exitCode).toBe(0);
      expect(mutations(mock.calls())).toHaveLength(0);
    } finally {f.cleanup();}
  }, 10_000);
  test("resumes a matching partial draft without overwriting assets",()=>{
    const f=fixture();try {
      const mock=installProviderMock(f);writeFileSync(mock.state,JSON.stringify({...f.release,draft:true,immutable:false,assets:f.release.assets.slice(0,1)}));
      const result=mock.run();expect(result.stderr.toString()).toBe("");expect(result.exitCode).toBe(0);
      expect(mutations(mock.calls()).map(c=>c[1])).toEqual([...Array(4).fill("upload"),"edit"]);
    } finally {f.cleanup();}
  }, 10_000);
  for(const [name,flag] of [["provider lookup denial","MOCK_LOOKUP_403"],["unverified provenance","MOCK_PROVENANCE_FAILURE"],["moved tag","MOCK_MOVED_TAG"],["current helper drift","MOCK_CONTROL_DRIFT"]]) test(`does not publish after ${name}`,()=>{
    const f=fixture();try {
      const mock=installProviderMock(f);const result=mock.run({[flag!]:"true"});expect(result.exitCode).not.toBe(0);
      expect(mutations(mock.calls())).toHaveLength(0);
    } finally {f.cleanup();}
  });
  test("discovers a matching draft on a later page and retains its provider ID",()=>{
    const f=fixture();try {
      const mock=installProviderMock(f);
      writeFileSync(mock.state,JSON.stringify({...f.release,draft:true,immutable:false,assets:f.release.assets}));
      const result=mock.run({MOCK_RELEASE_PAGE:"2"});
      expect(result.stderr.toString()).toBe("");expect(result.exitCode).toBe(0);
      expect(mutations(mock.calls()).map(c=>c[1])).toEqual(["edit"]);
      expect(mock.calls().some(c=>c.some(a=>a.endsWith("page=2")))).toBe(true);
    } finally {f.cleanup();}
  });
  for(const flag of ["MOCK_DUPLICATE_DRAFT","MOCK_RELEASE_ID_DRIFT"])test(`rejects ambiguous draft discovery: ${flag}`,()=>{
    const f=fixture();try {
      const mock=installProviderMock(f);
      writeFileSync(mock.state,JSON.stringify({...f.release,draft:true,immutable:false,assets:[]}));
      expect(mock.run({[flag]:"true"}).exitCode).not.toBe(0);
      expect(mutations(mock.calls())).toHaveLength(0);
    } finally {f.cleanup();}
  });
  test("rejects changed trusted handoff before invoking provenance or mutation",()=>{
    const f=fixture();try {
      const mock=installProviderMock(f);
      const result=mock.run({EXPECTED_ARCHIVE_SHA256:"e".repeat(64)});
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("Handoff differs from trusted");
    } finally {f.cleanup();}
  });
  test("does not regress Latest or reinterpret another attempt's draft",()=>{
    const f=fixture();try {
      const mock=installProviderMock(f);expect(mock.run({MOCK_LATEST:"v0.3.4"}).exitCode).not.toBe(0);
      expect(mutations(mock.calls())).toHaveLength(0);
      writeFileSync(mock.state,JSON.stringify({...f.release,draft:true,immutable:false,assets:[],body:releaseBody({...f.m,runAttempt:2})}));
      expect(mock.run().exitCode).not.toBe(0);
      expect(mutations(mock.calls())).toHaveLength(0);
    } finally {f.cleanup();}
  });
});


describe("delayed canonical npm mirror",()=>{
  test("admits immutable source behind current main and rejects unfinished or unreachable source",()=>{
    const f=fixture();try {
      const mock=installProviderMock(f);
      writeFileSync(mock.state,JSON.stringify(f.release));
      const fixturePath=join(f.root,"fixture.json");
      const original=JSON.parse(readFileSync(fixturePath,"utf8"));
      expect(mock.mirror(join(f.root,"unfinished")).exitCode).not.toBe(0);
      original.attempt.status="completed";original.attempt.conclusion="success";
      writeFileSync(fixturePath,JSON.stringify(original));
      const delayed=mock.mirror(join(f.root,"delayed"));
      expect(delayed.stderr.toString()).toBe("");expect(delayed.exitCode).toBe(0);
      expect(mock.mirror(join(f.root,"unreachable"),{MOCK_UNREACHABLE_SOURCE:"true"}).exitCode).not.toBe(0);
      expect(mock.mirror(join(f.root,"stale-workflow"),{EXPECTED_WORKFLOW_SHA:"e".repeat(40)}).exitCode).not.toBe(0);
      expect(mock.calls().filter(c=>c[0]==="release"&&c[1]!=="download")).toHaveLength(0);
    } finally {f.cleanup();}
  });
});
