import express, { Request, Response, RequestHandler } from "express";
import bodyParser from "body-parser";
import http from "http";
import { Validator, compileSchema } from "@jddf/jddf";
import fs from "fs";
import { MongoClient } from "mongodb";

// Event and EventOrderCompleted are code-generated from event.jddf.yaml.
//
// Go ahead and take a look at its contents if you wish! It's probably the exact
// same code you would have written by hand.
import { Event, EventOrderCompleted } from "./event";

// This is just boilerplate stuff to make Express, a web framework, work with
// Promises. Nothing interesting here.
function asyncMiddleware(
  fn: (req: Request, res: Response) => Promise<any>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

async function main() {
  // This is just connecting to Mongo. Typical stuff.
  const client = await MongoClient.connect("mongodb://localhost:27017", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  // Here, we're reading the schema, in JSON form, from the filesystem.
  const schemaText = fs.readFileSync("event.jddf.json", "utf-8");

  // Next, we parse that schema.
  const rawSchema = JSON.parse(schemaText);

  // Finally, we compile it. This will throw an error if the schema isn't valid.
  const schema = compileSchema(rawSchema);

  // Validator instances can verify whether data satisfies a schema, and returns
  // errors if there are problems.
  //
  // If you wanted to be a bit more performant and just care about whether there
  // are any errors at all -- as opposed to returning all errors at once, which
  // is the default -- then you can do:
  //
  // const validator = new Validator({ maxErrors: 1 })
  const validator = new Validator();

  // This is the endpoint for inserting events. It's bound to POST /v1/events.
  async function postEvent(req: Request, res: Response) {
    // Here, we're validating the data is correct.
    //
    // If you've written TypeScript web servers before, you've probably
    // implemented this sort of stuff with the "@hapi/joi" or "ow" packages.
    // Those are great, but they have two problems:
    //
    // 1. It's very easy to accidentally diverge between your validations and
    //    your TypeScript types, and
    //
    // 2. If you have other backends in different languages, then
    //    TypeScript-only validation has to be duplicated in other languages.
    //
    // JDDF solves this problem for you. Both the validation and the code
    // generation is done in a portable fashion, so you can spend less time
    // worrying about bad data, and more time doing your interesting business
    // logic.
    const errors = validator.validate(schema, req.body);
    if (errors.length > 0) {
      // The errors we return here are standardized, and all implementations of
      // JDDF across all languages return the exact same error here.
      //
      // By returning JDDF errors as part of your public API, you are free to
      // switch out language backends without worrying about emulating a legacy
      // validator's error format.
      return res.status(400).json(errors);
    }

    // This cast is 100% safe! Since the "Event" type was generated from the
    // same schema we just validated against before, and we just checked that
    // the request body satsifes the schema, you can safely perform this cast.
    const event = req.body as Event;

    // Insert the data into Mongo. Since this only happens post-validation, only
    // good data gets into Mongo.
    await client
      .db("example")
      .collection("events")
      .insertOne(event);

    // Echo back the data we inserted.
    res.status(200).json(event);
  }

  // This is the endpoint for getting the lifetime value ("LTV", in marketing
  // parlance) of a user ID. It's just the sum of all the revenue from a user.
  //
  // This lives at GET /v1/ltv?userId=XXX
  async function getLTV(req: Request, res: Response) {
    // Here, we're fetching data which we know to be of a particular subtype of
    // analytics events. JDDF can't check this step for us, but this is still
    // safe to perform, asssuming we spell "Order Completed" correctly in the
    // query below.
    //
    // By specifying which sub-type of "Event" we're pulling out here, we'll be
    // able to have TypeScript help us write type-safe code to manipulate these
    // "Order Completed" events.
    const events: EventOrderCompleted[] = await client
      .db("example")
      .collection("events")
      .find({ type: "Order Completed", userId: req.query.userId })
      .toArray();

    // The following code is type-safe. TypeScript knows that event.revenue is a
    // number, and lets us do this logic.
    let ltv = 0;
    for (const event of events) {
      ltv += event.revenue;
    }

    // Return back the calculated LTV.
    res.status(200).json({ ltv });
  }

  // The rest of this logic is uninteresting boilerplate. It just sets up the
  // HTTP server, the endpoints, and starts listening on port 3000.
  const app = express();
  app.use(bodyParser.json());
  app.post("/v1/events", asyncMiddleware(postEvent));
  app.get("/v1/ltv", asyncMiddleware(getLTV));

  const server = http.createServer(app);
  server.listen("3000", () => {
    console.log("Server listening on localhost:3000");
  });
}

// Start the server off!
main();
