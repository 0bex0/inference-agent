import * as process from 'process';

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { ChatGroq } from '@langchain/groq'
import { MessagesAnnotation, StateGraph } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { TavilySearch } from '@langchain/tavily'
import * as dotenv from 'dotenv'
import { z } from 'zod'
import testData from './test.json';

import { classifyRouteElevation } from './utils.js'

// Config
dotenv.config()
const groqConfig = {
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile',
    maxRetries: 2,
    timeout: 10000,
}

// Schemas
const outputSchema = {
    name: 'responseFormatter',
    schema: {
        title: 'VehicleRoadCondition',
        type: 'object',
        properties: {
            fuel: {
                type: 'string',
                enum: [
                    'gasoline',
                    'diesel',
                    '99_diesel_1_biodiesel',
                    '98_diesel_2_biodiesel',
                    '95_diesel_5_biodiesel',
                    '93_diesel_7_biodiesel',
                    '90_diesel_10_biodiesel',
                    '80_diesel_20_biodiesel',
                    '50_diesel_50_biodiesel',
                    'ethanol_from_corn',
                    'hvo_from_tallow',
                    'lpg',
                    'cng',
                ],
            },
            gradient: {
                type: 'string',
                enum: ['flat', 'hilly', 'mountainous'],
            },
            situation: {
                type: 'string',
                enum: [
                    'city_urban_freeflow',
                    'motorway_urban_freeflow',
                    'motorway_rural_freeflow',
                    'city_urban_heavy_traffic',
                    'city_urban_stop_and_go',
                    'motorway_urban_heavy_traffic',
                    'motorway_urban_stop_and_go',
                    'motorway_rural_heavy_traffic',
                    'motorway_rural_stop_and_go',
                    'arterial_road_rural_freeflow',
                    'arterial_road_rural_heavy_traffic',
                    'arterial_road_rural_stop_and_go',
                ],
            },
            fuel_consumed: {
                type: 'number',
            },
        },
        required: ['fuel', 'gradient', 'situation', 'fuel_consumed'],
        additionalProperties: false,
    },
}
const querySchema = z.object({
    query: z.string(),
})
const routeSchema = z.object({
    start: z.string(),
    end: z.string(),
})

// Tools
const tavilySearch = new TavilySearch({
    maxResults: 5,
    topic: 'general',
    includeAnswer: true,
    searchDepth: 'advanced',
    includeRawContent: 'text',
    includeDomains: ['https://www.tomtom.com/traffic-index'],
})
const tavilySearchTool = tool(
    async (input) => {
        return (await tavilySearch.invoke({ query: input.query })).answer
    },
    {
        name: 'tavily_traffic_search',
        description: 'Find detailed traffic information for precise times and locations',
        schema: querySchema,
    },
)
// const googleRoutes = new GoogleRoutesAPI()
const googleRoutesTool = tool(
    async (input) => {
        return classifyRouteElevation(input.start, input.end, process.env.GOOGLE_ROUTES_API_KEY!)
    },
    {
        name: 'google_routes_tool',
        description: 'Find detailed traffic, information for precise times and locations',
        schema: routeSchema,
    },
)
const toolNode = new ToolNode([googleRoutesTool, tavilySearchTool])

// Models
const llm = new ChatGroq(groqConfig).bindTools([googleRoutesTool, tavilySearchTool])
const structuredLlm = new ChatGroq(groqConfig).withStructuredOutput(outputSchema)

// Workflow functions
function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
    const lastMessage = messages[messages.length - 1] as AIMessage
    return lastMessage.tool_calls?.length !== 0 ? 'tools' : 'respond'
}
async function callModel(state: typeof MessagesAnnotation.State) {
    return { messages: [await llm.invoke(state.messages)] }
}
function respond({ messages }: typeof MessagesAnnotation.State) {
    return {
        final_message: structuredLlm.invoke([
            new HumanMessage((messages[messages.length - 2] as ToolMessage).content.toString()),
        ]),
    }
}

// Workflow
const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addEdge('__start__', 'agent') // __start__ is a special name for the entrypoint
    .addNode('tools', toolNode)
    .addNode('respond', respond)
    .addEdge('tools', 'agent')
    .addConditionalEdges('agent', shouldContinue)
    .addEdge('respond', '__end__')

// Compile
const app = workflow.compile()

// Messages
const systemMessage = `
You are a routing and geography expert.
You will be provided with the source and destination of a road journey, along with the date the journey occurred.
Your job is to infer three facts about the journey:
  - Gradient: The gradient of the terrain across the journey
  - Fuel Type: The fuel used along the journey
  - Traffic: The traffic situation on the day of the journey given the day of the week
  - Fuel Consumed: The amount of fuel used along the journey in litres

Three of the inferred properties must be selected from an enum:
  - Gradient:
    ['flat', 'hilly', 'mountainous']
  - Traffic:[
    'city_urban_freeflow',
    'motorway_urban_freeflow',
    'motorway_rural_freeflow',
    'city_urban_heavy_traffic',
    'city_urban_stop_and_go',
    'motorway_urban_heavy_traffic',
    'motorway_urban_stop_and_go',
    'motorway_rural_heavy_traffic',
    'motorway_rural_stop_and_go',
    'arterial_road_rural_freeflow',
    'arterial_road_rural_heavy_traffic',
    'arterial_road_rural_stop_and_go',
  ]
  - Fuel Type: [
    'gasoline',
    'diesel',
    '99_diesel_1_biodiesel',
    '98_diesel_2_biodiesel',
    '95_diesel_5_biodiesel',
    '93_diesel_7_biodiesel',
    '90_diesel_10_biodiesel',
    '80_diesel_20_biodiesel',
    '50_diesel_50_biodiesel',
    'ethanol_from_corn',
    'hvo_from_tallow',
    'lpg',
    'cng',
  ]

Default to gasoline or diesel if you can't determine a more specific fuel.
Use all tools at your disposal. Some are better suited for certain tasks:
Google Routes API - Provides information regarding fuel consumption, terrain and traffic
Tavily Search - Provides highly specific information regarding the traffic of different regions based on time/day
`

// Execution
const finalState = await app.invoke({
    messages: [new SystemMessage(systemMessage), new HumanMessage(JSON.stringify(testData, null, 2))],
})
console.log(finalState.messages[finalState.messages.length - 1].content)
