import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { callKimiChatCompletion } from './kimi-client.js';

const server = new Server(
  {
    name: 'kimi-mcp-proxy',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'kimi_chat',
      description: 'Send a chat completion request to Kimi through the configured API key.',
      inputSchema: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['role', 'content']
            }
          },
          model: { type: 'string' },
          temperature: { type: 'number' },
          max_tokens: { type: 'number' }
        },
        required: ['messages']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'kimi_chat') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments || {};
  const result = await callKimiChatCompletion({
    ...args,
    stream: false
  });

  return {
    content: [
      {
        type: 'text',
        text: result.choices?.[0]?.message?.content || JSON.stringify(result)
      }
    ]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
