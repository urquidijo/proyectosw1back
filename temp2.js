const { z } = require('zod');

const schema = z.object({
  name: z.string()
});

console.log(JSON.stringify(z.toJSONSchema(schema), null, 2));
