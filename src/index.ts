import express, { Request, Response, RequestHandler } from "express";
import bodyParser from "body-parser";
import http from "http";
import { Validator, compileSchema } from "@jddf/jddf";
import fs from "fs";
import { Event, EventOrderCompleted } from "./event";
import { MongoClient } from "mongodb";

function asyncMiddleware(
  fn: (req: Request, res: Response) => Promise<any>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

async function main() {
  const client = await MongoClient.connect("mongodb://localhost:27017", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const schemaText = fs.readFileSync("event.jddf.json", "utf-8");
  const rawSchema = JSON.parse(schemaText);
  const schema = compileSchema(rawSchema);

  const validator = new Validator();

  async function postEvent(req: Request, res: Response) {
    const errors = validator.validate(schema, req.body);
    if (errors.length > 0) {
      return res.status(400).json(errors);
    }

    const event = req.body as Event;

    await client
      .db("example")
      .collection("events")
      .insertOne(event);

    res.status(200).json(event);
  }

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

  const app = express();
  app.use(bodyParser.json());
  app.post("/v1/events", asyncMiddleware(postEvent));
  app.get("/v1/ltv", asyncMiddleware(getLTV));

  const server = http.createServer(app);
  server.listen("3000", () => {
    console.log("Server listening on localhost:3000");
  });
}

main();
