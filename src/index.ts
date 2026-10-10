import { handleMcp } from "./mcp/server.js";
import { handleFetch } from "./routes.js";

type WorkerEnv = Env & {
  ASTRAFLOW_API_KEY?: string;
  ASTRAFLOW_MODEL?: string;
  ASTRAFLOW_THINKING?: string;
  WORKSHOP_KEY?: string;
};

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleFetch(request, env, (mcpRequest) => handleMcp(mcpRequest, env));
  },
} satisfies ExportedHandler<WorkerEnv>;
