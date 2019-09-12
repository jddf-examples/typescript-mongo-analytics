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
