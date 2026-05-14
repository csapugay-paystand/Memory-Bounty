// Minimal Express-style request/response types for the fixture
interface Req {
  params: Record<string, string>;
  body: unknown;
  method: string;
  path: string;
}
interface Res {
  json: (body: unknown) => void;
  status: (code: number) => Res;
  send: (body?: string) => void;
}

// Retrieves a user by ID; looks up the record and returns it as JSON
export const handleGetUser = async (req: Req, res: Res): Promise<void> => {
  const { id } = req.params;
  res.json({ id, name: "Alice", email: "alice@example.com" });
};

// Creates a new user record from the request body and returns the created entity with a generated ID
export const handleCreateUser = async (req: Req, res: Res): Promise<void> => {
  const { name, email } = req.body as { name: string; email: string };
  const id = Math.random().toString(36).slice(2);
  res.status(201).json({ id, name, email });
};

// Deletes a user by ID and responds with 204 No Content
export const handleDeleteUser = async (req: Req, res: Res): Promise<void> => {
  const { id } = req.params;
  void id;
  res.status(204).send();
};

// Registers request logging middleware on an Express-style app
export function applyMiddleware(app: { use: (fn: unknown) => void }): void {
  app.use((req: Req, _res: unknown, next: () => void) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}
