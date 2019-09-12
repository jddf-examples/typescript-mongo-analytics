# JDDF Example: typescript-mongo-analytics

This repo is an example of how you can use JDDF in the real world. It's meant to
emulate a TypeScript server which stores analytics data into a MongoDB backend.

Some cool aspects of this example:

- 100% in TypeScript, and 100% type-safe. If the JDDF validator says the data is
  valid, then it's safe to cast `any` into the generated TypeScript interfaces.
- Data is validated before being inserted into Mongo.
- Data is casted into human-friendly TypeScript interfaces when read out of
  Mongo. We don't have to worry about invalid data, or have to manipulate
  instances of `any`. Yay for autocompletion!
- The schema of analytics events is described in
  [`event.jddf.yaml`](./event.jddf.yaml).
- Inputted events are validated against that schema using
  [`@jddf/jddf`](https://github.com/jddf/jddf-js)
- [`jddf-codegen`](https://github.com/jddf/jddf-codegen) generates TypeScript
  interfaces for analytics events from the schema.

The code for this example is thorougly documented, describing some of the subtle
things JDDF does for you. All of the interesting logic is in
[`src/index.ts`](./src/index.ts).

## Highlight: no more diverging `joi`/`ow` and TypeScript!

If you've written TypeScript web servers before, you've probably implemented
this sort of stuff with the [`@hapi/joi`](https://github.com/hapijs/joi) or
[`ow`](https://github.com/sindresorhus/ow) packages:

```ts
// This example uses `@hapi/joi`, but the `ow` equivalent is basically the same.
import joi from "@hapi/joi";

// The data you want to be manipulating.
interface User {
  id: string;
  name: string;
  favoriteNumbers?: number[];
}

// The schema you use to validate instances.
const schema = joi.object({
  id: joi.string().required(),
  name: joi.string().required(),
  favoriteNumbers: joi
    .array()
    .items(joi.number())
    .required(),
});

// And then, you first check against the schema before casting into your type:
try {
  await schema.validate(req.body);

  // We made it past the validation. We can now safely cast:
  const user = req.body as User;
} catch (err) {
  // If the request body is invalid, we'll return the validation errors back to
  // the user.
  res.status(400).json(err);
}
```

### The problem

Here's the problem with this approach. First, it's all to easy to let the schema
and TypeScript interface diverge. If you decide to make `favoriteNumbers` a
non-optional field in the future:

```ts
interface User {
  id: string;
  name: string;
  favoriteNumbers: number[]; // Removed the `?` that was here before.
}
```

Then TypeScript will let you stop writing guards against `undefined`. But
whoops! You forgot to update your `joi` schema! So now, if a user sends you:

```json
{ "id": "bob", "name": "Bob" }
```

Then there's a good chance you'll get some error like this in production:

```txt
TypeError: Cannot read property 'length' of undefined
```

Avoiding problems like this is a big part of why TypeScript is so great. But
TypeScript doesn't have a run-time type checker, so it's all too easy to get
into this situation.

### How JDDF solves this

With JDDF, you don't need to write validators or interfaces by hand. Instead,
describe your schema in a convenient format like this:

```yaml
properties:
  id:
    type: string
  name:
    type: string
optionalProperties:
  favoriteNumbers:
    elements:
      type: float64
```

That YAML is equivalent to the `joi` schema from before. With this schema you
can:

- Automate your **validation** with
  [`@jddf/jddf`](https://github.com/jddf/jddf-js).
- Generate your **types** with
  [`jddf-codegen`](https://github.com/jddf/jddf-codegen).

The type generation is as easy as:

```bash
yaml2json user.jddf.yaml > user.jddf.json
jddf-codegen --ts-out=src/models/user -- user.jddf.json
```

That'll generate a `src/models/user/index.ts` like this:

```ts
interface User {
  id: string;
  name: string;
  favoriteNumbers?: number[];
}
```

The validation looks a lot like the code from above, but this time it's
foolproof:

```ts
import schema from "user.jddf.json";
import { Validator, compileSchema } from "@jddf/jddf";

// Now, our types are generated from the schema. The schema is your single
// source of truth.
import { User } from "./models/user";

const schema = compileSchema(schema);
const errors = new Validator().validate(schema, req.body);

if (errors) {
  res.status(400).json(errors);
}

// We got past the validation step. This type-cast is safe:
const user = req.body as User;
```

It's the same idea as before, but with all the error-prone steps automated!

### How JDDF helps you scale

It's not obvious at first, but there are two other issues with the `joi`/`ow`
approach described above:

1. You can't portably validate data from non-JavaScript backends
2. You can't easily change validation backends without breaking clients

Problem (1) is probably obvious. `joi` only works for JavaScript. If some Golang
service needs to do the same validation, then you can't share a single source of
truth of what a "user" is between your services. This is especially problematic
when you have multiple clients, written different languages, consuming from some
queue where the messages are in JSON. Or if two services, written in different
languages, are writing to the same database or queue.

To illustrate (2), let's look again at the first code example:

```ts
try {
  await schema.validate(req.body);

  // We made it past the validation. We can now safely cast:
  const user = req.body as User;
} catch (err) {
  // If the request body is invalid, we'll return the validation errors back to
  // the user.
  res.status(400).json(err);
}
```

We're returning the `joi` error back to the user. If you're doing that in a
public API, you can be sure your API consumers will start relying on those
helpful errors to do useful things. Whatever `joi` returns, that's now part of
your public contract. So you have two options:

1. Strip validation errors, or otherwise obfuscate them so consumers can't rely
   on them. This is bad user experience.
2. Just return `joi`'s errors. If you ever move on to another validation system,
   such as if you port your service from JavaScript to some other language,
   you'll have to re-implement `joi`'s error format or break clients.

In summary, the `joi`/`ow` approach works just fine at first, and you should
consider it a legitimate option. But down the road, it might leave you stuck
with inconsistent data, less-than-ideal user experiences, or reduced velocity
when it comes time to refactor your systems.

**But JDDF solves both problems.** JDDF is a fundamentally portable solution.
This is because:

1. In JDDF, validation errors are standardized. Every implementation returns the
   exact same errors. So there's no lock-in.
2. The `jddf-codegen` tool can generate code in multiple languages from the same
   schema. So the schema can be your cross-language source of truth.

In TypeScript, we used an NPM package to validate data, and `jddf-codegen` to
generate TypeScript interfaces. If you wanted to use Golang instead, you can use
`github.com/jddf/jddf-go` to validate, and `jddf-codegen` with the `--go-out=`
parameter to generate your Golang.

And JDDF does so without meaningfully slowing down your velocity. It's a faster
and safer alternative.

## Demo

### Starting the server

Let's start up the server! We'll need a Mongo to talk to, and the included
`docker-compose.yml` has you covered:

```bash
docker-compose up -d
```

Next, let's do the code-generation:

```bash
yarn jddf-codegen
```

(For that command to work, you'll need the `jddf-codegen` tool. On Mac, you can
install that with `brew install jddf/jddf/jddf-codegen`.)

We can now start the server:

```bash
yarn server
```

### Sending a valid event

Let's first demonstrate the happy case by sending a valid event.

```bash
curl localhost:3000/v1/events \
  -H "Content-Type: application/json" \
  -d '{"type": "Order Completed", "userId": "bob", "timestamp": "2019-09-12T03:45:24+00:00", "revenue": 9.99}'
```

The server echoes back what it inserted into Mongo:

```
{"type":"Order Completed","userId":"bob","timestamp":"2019-09-12T03:45:24+00:00","revenue":9.99,"_id":"5d79cbc30dbb30514f87c1a5"}
```

### Invalid events get consistent validation errors

But what if we sent nonsense data? The answer: the JDDF validator will reject
that data with a standardized error.

```bash
curl localhost:3000/v1/events \
  -H "Content-Type: application/json" \
  -d '{}'
```

The returned status code is 400 (Bad Request), and the error message describes
what part of the input ("instance") and schema didn't play well together:

```
[{"instancePath":[],"schemaPath":["discriminator","tag"]}
```

Here's another example of bad data. What if we used a string instead of a number
for `revenue`, and forgot to include a timestamp?

```bash
curl localhost:3000/v1/events \
  -H "Content-Type: application/json" \
  -d '{"type": "Order Completed", "userId": "bob", "revenue": "100"}' | jq
```

There's now a few problems with the input, so we piped it to `jq` to make it
more human-readable:

```json
[
  {
    "instancePath": [],
    "schemaPath": [
      "discriminator",
      "mapping",
      "Order Completed",
      "properties",
      "timestamp"
    ]
  },
  {
    "instancePath": ["revenue"],
    "schemaPath": [
      "discriminator",
      "mapping",
      "Order Completed",
      "properties",
      "revenue",
      "type"
    ]
  }
]
```

The first error indicates that the instance is missing `timestamp`. The second
error indicates that `revenue` has the wrong type.

### Reading data back out in a type-safe way

Since we're validating the data before putting it into Mongo, we can safely cast
the data into our TypeScript interfaces when fetching it back out.

That means we can write some sweet code like this:

```ts
async function getLTV(req: Request, res: Response) {
  const events: EventOrderCompleted[] = await client
    .db("example")
    .collection("events")
    .find({ type: "Order Completed", userId: req.query.userId })
    .toArray();

  let ltv = 0;
  for (const event of events) {
    ltv += event.revenue;
  }

  res.status(200).json({ ltv });
}
```

That is the entire body of logic that lets use calculate the life-time value, or
"LTV", of a user -- basically, the sum of all the purchases they've made with
us. Here's an example:

```bash
# Let's have alice make two purchases -- one for $40, another for $2.
curl localhost:3000/v1/events \
  -H "Content-Type: application/json" \
  -d '{"type": "Order Completed", "userId": "alice", "timestamp": "2019-09-12T03:45:24+00:00", "revenue": 40}'
curl localhost:3000/v1/events \
  -H "Content-Type: application/json" \
  -d '{"type": "Order Completed", "userId": "alice", "timestamp": "2019-09-12T03:45:24+00:00", "revenue": 2}'
```

Here's us calculating Alice's LTV:

```bash
curl localhost:3000/v1/ltv?userId=alice | jq
```

```json
{
  "ltv": 42
}
```

## Bonus: Automatically generating random events

Oftentimes, it's useful to seed a system like this with some reasonable data,
just test stuff like performance, logging, stats, or other things that require a
bit of volume to test with.

The [`jddf-fuzz`](https://github.com/jddf/jddf-fuzz) tool lets you do exactly
this. Feed `jddf-fuzz` a schema, and it'll generate some random data which
satisfies the schema. For example, here are five randomized analytics events:

```bash
jddf-fuzz -n 5 event.jddf.json
```

```json
{"timestamp":"2005-12-19T06:25:48+00:00","type":"Heartbeat","userId":"4\\"}
{"timestamp":"2015-04-27T23:10:53+00:00","type":"Heartbeat","userId":"Lj"}
{"revenue":0.023312581581551584,"timestamp":"2010-02-10T18:26:48+00:00","type":"Order Completed","userId":"7HJE]G"}
{"timestamp":"1951-09-09T01:18:47+00:00","type":"Page Viewed","url":"F","userId":"RA"}
{"revenue":0.636091000399497,"timestamp":"1919-03-13T10:25:49+00:00","type":"Order Completed","userId":"vh)c"}
```

It ain't beautiful data, but it'll do. Let's insert a thousand of these events
into our server with this command:

```bash
for _ in {0..1000}; do
  jddf-fuzz -n 1 event.jddf.json |
    curl localhost:3000/v1/events -H "Content-Type: application/json" -d @-
done
```

This will hammer the service with events that all will go into Mongo. Pretty
nifty how easy it is to do that!

You can install `jddf-fuzz` on Mac with `brew install jddf/jddf/jddf-fuzz`.
