'use strict';
// ══════════════════════════════════════════════════════════════════
// HermesWork v6.0.0 — New Agent Tool Definitions & Handlers
// This file documents the 4 new MCP tools added in v6.0.0
// They are wired into server.js via getAgentFx() calls
// ══════════════════════════════════════════════════════════════════

// NEW MCP TOOLS (v6.0.0) — add these to MCP_TOOLS in server.js:
//
// { name:'tree_of_thoughts', description:'🧠 Tree of Thoughts: BFS over 3 proposal strategy branches (Value/Authority/Problem-First), scores each, synthesizes winner. 3x faster than human brainstorming. (Yao et al., 2023 ArXiv 2305.10601)', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},requirements:{type:'string'},budget:{type:'number'},context:{type:'string'}},required:['jobTitle','requirements']} },
// { name:'self_discover_plan', description:'🔍 Self-Discover: LLM self-composes a task-specific reasoning structure (SELECT atomic modules → ADAPT to task → IMPLEMENT) for any business problem. (Zhou et al., 2024 ArXiv 2402.03620)', inputSchema:{type:'object',properties:{task:{type:'string'},domain:{type:'string',enum:['proposal','pricing','client','growth','operations']}},required:['task']} },
// { name:'mixture_of_agents', description:'🌊 Mixture of Agents: 3 parallel Hermes 3 generators (Direct, Consultative, Data-Driven) → Aggregator synthesizes best-of-all proposal. Outperforms single-model generation. (Together AI, 2024 ArXiv 2406.04692)', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},requirements:{type:'string'},budget:{type:'number'},mySkills:{type:'string'}},required:['jobTitle','requirements']} },
// { name:'llm_judge', description:'⚖️ LLM-as-Judge: Position-bias-mitigated pairwise evaluation — compare 2 proposals head-to-head with forward + reverse scoring. (Zheng et al., 2023 ArXiv 2306.05685)', inputSchema:{type:'object',properties:{proposalA:{type:'string'},proposalB:{type:'string'},jobTitle:{type:'string'},criteria:{type:'string'}},required:['proposalA','proposalB','jobTitle']} },

// NEW TOOL EXECUTORS — add these inside executeMcpTool() in server.js:
//
// if (toolName==='tree_of_thoughts') {
//   const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable');
//   return await fx.treeOfThoughts(args.jobTitle,args.requirements,args.budget,args.context);
// }
// if (toolName==='self_discover_plan') {
//   const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable');
//   return await fx.selfDiscoverPlan(args.task,args.domain);
// }
// if (toolName==='mixture_of_agents') {
//   const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable');
//   return await fx.mixtureOfAgents(args.jobTitle,args.requirements,args.budget,args.mySkills);
// }
// if (toolName==='llm_judge') {
//   const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable');
//   return await fx.llmJudge(args.proposalA,args.proposalB,args.jobTitle,args.criteria);
// }

const V6_MCP_TOOLS = [
  { name:'tree_of_thoughts', description:'🧠 Tree of Thoughts: BFS over 3 proposal strategy branches (Value/Authority/Problem-First), scores each, synthesizes winner. 3x faster than human brainstorming. (Yao et al., 2023 ArXiv 2305.10601)', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},requirements:{type:'string'},budget:{type:'number'},context:{type:'string'}},required:['jobTitle','requirements']} },
  { name:'self_discover_plan', description:'🔍 Self-Discover: LLM self-composes a task-specific reasoning structure (SELECT atomic modules → ADAPT to task → IMPLEMENT) for any business problem. (Zhou et al., 2024 ArXiv 2402.03620)', inputSchema:{type:'object',properties:{task:{type:'string'},domain:{type:'string',enum:['proposal','pricing','client','growth','operations']}},required:['task']} },
  { name:'mixture_of_agents', description:'🌊 Mixture of Agents: 3 parallel Hermes 3 generators (Direct, Consultative, Data-Driven) → Aggregator synthesizes best-of-all proposal. Outperforms single-model generation. (Together AI, 2024 ArXiv 2406.04692)', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},requirements:{type:'string'},budget:{type:'number'},mySkills:{type:'string'}},required:['jobTitle','requirements']} },
  { name:'llm_judge', description:'⚖️ LLM-as-Judge: Position-bias-mitigated pairwise evaluation — compare 2 proposals head-to-head with forward + reverse scoring. (Zheng et al., 2023 ArXiv 2306.05685)', inputSchema:{type:'object',properties:{proposalA:{type:'string'},proposalB:{type:'string'},jobTitle:{type:'string'},criteria:{type:'string'}},required:['proposalA','proposalB','jobTitle']} }
];

async function executeV6Tool(toolName, args, getAgentFx) {
  if (toolName==='tree_of_thoughts') {
    const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable');
    return await fx.treeOfThoughts(args.jobTitle,args.requirements,args.budget,args.context);
  }
  if (toolName==='self_discover_plan') {
    const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable');
    return await fx.selfDiscoverPlan(args.task,args.domain);
  }
  if (toolName==='mixture_of_agents') {
    const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable');
    return await fx.mixtureOfAgents(args.jobTitle,args.requirements,args.budget,args.mySkills);
  }
  if (toolName==='llm_judge') {
    const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable');
    return await fx.llmJudge(args.proposalA,args.proposalB,args.jobTitle,args.criteria);
  }
  return null; // not a v6 tool
}

const V6_AGENT_REGISTRY = [
  {id:10,name:'TreeOfThoughtsAgent',paper:'Yao et al., 2023',arxiv:'2305.10601',capability:'BFS over 3 proposal strategy branches — Value, Authority, Problem-First',mcpTool:'tree_of_thoughts',status:'active',innovation:'Parallel branch generation + evaluation + synthesis'},
  {id:11,name:'SelfDiscoverAgent',paper:'Zhou et al., 2024',arxiv:'2402.03620',capability:'Self-composes task-specific reasoning structure: SELECT → ADAPT → IMPLEMENT',mcpTool:'self_discover_plan',status:'active',innovation:'Dynamic reasoning structure composition, no fixed CoT'},
  {id:12,name:'MixtureOfAgentsAggregator',paper:'Together AI, 2024',arxiv:'2406.04692',capability:'3 diverse generators (Direct, Consultative, Data-Driven) → Aggregator synthesis',mcpTool:'mixture_of_agents',status:'active',innovation:'Multi-perspective proposal generation outperforms single-model'},
  {id:13,name:'LLMJudgeAgent',paper:'Zheng et al., 2023',arxiv:'2306.05685',capability:'Position-bias-mitigated pairwise proposal evaluation (forward + reverse)',mcpTool:'llm_judge',status:'active',innovation:'Forward+reverse evaluation eliminates position bias'}
];

module.exports = { V6_MCP_TOOLS, executeV6Tool, V6_AGENT_REGISTRY };
