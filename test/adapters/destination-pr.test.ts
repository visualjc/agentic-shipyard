import assert from "node:assert/strict";
import test from "node:test";
import { GitHubStagedProviderAuthority } from "../../src/adapters/destination-pr.js";
import type { GitHubRestRequest } from "../../src/github/types.js";
import { stableShipyardMarker } from "../../src/github/markers.js";
import { destinationDossier, destinationMarker } from "../../src/promotion/provider.js";

const sha="a".repeat(40),development={owner:"acme",name:"development",remote:{name:"origin",url:"https://github.com/acme/development.git"},defaultBranch:"main"},destination={owner:"acme",name:"destination",remote:{name:"destination",url:"https://github.com/acme/destination.git"},defaultBranch:"main"};
function repo(owner:string,name:string){return {name,full_name:`${owner}/${name}`,owner:{login:owner}};}
function destinationRecord(overrides:Record<string,unknown>={}){return {node_id:"PR_dest",number:7,html_url:"https://github.com/acme/destination/pull/7",body:`dossier\n\n${destinationMarker("delivery")}`,state:"open",merged:false,head:{ref:"shipyard/delivery",sha,repo:repo("acme","destination")},base:{ref:"main",repo:repo("acme","destination")},...overrides};}
function developmentPull(state="open"){return {node_id:"PR_dev",number:3,html_url:"https://github.com/acme/development/pull/3",body:stableShipyardMarker("delivery"),state,merged:false,pull_request:{},head:{ref:"shipyard/delivery",sha,repo:repo("acme","development")},base:{ref:"main",repo:repo("acme","development")}};}
function developmentIssue(state="open"){return {node_id:"I_dev",number:2,html_url:"https://github.com/acme/development/issues/2",body:stableShipyardMarker("delivery"),state};}

class Api {
  readonly calls:GitHubRestRequest[]=[];destinationPull:ReturnType<typeof destinationRecord>|undefined;devPull=developmentPull();devIssue=developmentIssue();
  constructor(readonly actor="actor",readonly crossRepository=false){}
  async request<T>(call:GitHubRestRequest):Promise<T>{this.calls.push(structuredClone(call));let result:unknown;if(call.path==="/user")result={login:this.actor};
    else if(call.path==="/repos/acme/destination/pulls?state=all&per_page=100&page=1")result=this.destinationPull?[this.destinationPull]:[];
    else if(call.path==="/repos/acme/destination/pulls"&&call.method==="POST"){this.destinationPull=destinationRecord(this.crossRepository?{head:{ref:"shipyard/delivery",sha,repo:repo("other","fork")}}:{});result=this.destinationPull;}
    else if(call.path==="/repos/acme/destination/pulls/7"&&call.method==="GET")result=this.destinationPull;
    else if(call.path==="/repos/acme/destination/pulls/7"&&call.method==="PATCH"){this.destinationPull={...this.destinationPull!,body:String((call.body as {body:string}).body)};result=this.destinationPull;}
    else if(call.path==="/repos/acme/development/issues?state=all&per_page=100&page=1")result=[this.devIssue,this.devPull];
    else if(call.path==="/repos/acme/development/pulls?state=all&per_page=100&page=1")result=[this.devPull];
    else if(call.path==="/repos/acme/development/pulls/3"&&call.method==="GET")result=this.devPull;
    else if(call.path==="/repos/acme/development/pulls/3"&&call.method==="PATCH"){this.devPull=developmentPull("closed");result=this.devPull;}
    else if(call.path==="/repos/acme/development/issues/2"&&call.method==="GET")result=this.devIssue;
    else if(call.path==="/repos/acme/development/issues/2"&&call.method==="PATCH"){this.devIssue=developmentIssue("closed");result=this.devIssue;}
    else throw new Error(`unexpected ${call.method} ${call.path}`);return result as T;}
  authority(){return new GitHubStagedProviderAuthority({resolve:async()=>({authorizationValue:"Bearer secret-never-log"})},{forCredential:()=>this});}
}

test("verified actor creates one normal destination-owned PR and closes only exact development records",async()=>{const api=new Api(),session=await api.authority().open({actorLogin:"actor",development,destination}),dossier=destinationDossier("delivery",[{revision:1,developmentSha:sha,destinationParentSha:"b".repeat(40),destinationCommitSha:sha,destinationTreeSha:"c".repeat(40),projectedProductTreeSha:"c".repeat(40),policyDigest:"d".repeat(64),projectionDigest:"e".repeat(64),evidence:{productSha:sha,ledgerSha:"f".repeat(40),manifestDigest:"1".repeat(64),acceptanceDigest:"2".repeat(64),reviewId:"r",reviewRequestDigest:"3".repeat(64),reviewResultDigest:"4".repeat(64),reviewedLedgerSha:"5".repeat(40),reviewerBundleDigest:"6".repeat(64),evaluatedAt:"2026-08-04T00:00:00.000Z"},promotedAt:"2026-08-04T00:00:00.000Z"}]),pull=await session.reconcileDestinationPullRequest({deliveryId:"delivery",branch:"shipyard/delivery",base:"main",headSha:sha,title:"Deliver delivery",dossier});assert.equal(pull.isCrossRepository,false);assert.deepEqual(pull.headRepository,{owner:"acme",name:"destination"});assert.deepEqual(pull.baseRepository,{owner:"acme",name:"destination"});assert.equal(api.calls.filter(call=>call.method==="POST").length,1);await session.reconcileDestinationPullRequest({deliveryId:"delivery",branch:"shipyard/delivery",base:"main",headSha:sha,title:"Deliver delivery",dossier});assert.equal(api.calls.filter(call=>call.method==="POST").length,1);const records=await session.observeDevelopmentRecords("delivery");await session.closeDevelopmentPullRequest(records.pullRequest);await session.closeDevelopmentIssue(records.issue);assert.equal(api.devPull.state,"closed");assert.equal(api.devPull.merged,false);assert.equal(api.devIssue.state,"closed");assert.ok(!api.calls.some(call=>call.path.startsWith("/repos/acme/destination/issues")));assert.ok(!("createDestinationIssue" in session));assert.doesNotMatch(JSON.stringify(api.calls),/secret-never-log/);});

test("actor and cross-repository destination mismatches fail closed",async()=>{const wrongActor=new Api("someone-else");await assert.rejects(wrongActor.authority().open({actorLogin:"actor",development,destination}),/actor no longer matches/i);assert.equal(wrongActor.calls.filter(call=>call.method!=="GET").length,0);const forked=new Api("actor",true),session=await forked.authority().open({actorLogin:"actor",development,destination});await assert.rejects(session.reconcileDestinationPullRequest({deliveryId:"delivery",branch:"shipyard/delivery",base:"main",headSha:sha,title:"Deliver",dossier:"safe"}),/forked or cross-repository/i);assert.equal(forked.calls.filter(call=>call.path.includes("/issues")&&call.method!=="GET").length,0);});

test("dossier rejects development-repository and internal-ledger disclosure before a provider write",async()=>{const api=new Api(),session=await api.authority().open({actorLogin:"actor",development,destination});for(const dossier of ["acme/development","https://github.com/acme/development.git","shipyard-ledger","refs/shipyard/private"])await assert.rejects(session.reconcileDestinationPullRequest({deliveryId:"delivery",branch:"shipyard/delivery",base:"main",headSha:sha,title:"Deliver",dossier}),/dossier contains/i);assert.equal(api.calls.filter(call=>call.method!=="GET").length,0);});
