import { should } from "should";
import { json_extractor, Xml2Json, XmlAttributes } from "..";

const _should = should;

type ErrorCallback = (err?: Error) => void;

describe("XMLToJSON", () => {

    it("should parse a simple xml data string", (done: ErrorCallback) => {

        let init_called = false;
        let finish_called = false;
        const parser = new Xml2Json({

            parser: {

                person: {

                    init(name: string, attrs: XmlAttributes) {
                        name.should.equal("person");
                        attrs.should.have.property("name");
                        attrs.name.should.equal("John");
                        init_called = true;
                        this.parent.root.obj = {};
                        this.obj = this.parent.root.obj;
                        this.obj.name = attrs.name;
                    },

                    finish() {
                        this.obj.should.eql({ name: "John", address: "Paris" });
                        finish_called = true;
                    },

                    parser: {
                        address: {
                            finish() {
                                this.parent.obj.address = this.text;
                            }
                        }
                    }
                }
            }
        });

        parser.parseString(
          "<employees>" +
          "   <person name='John'>" +
          "     <address>Paris</address>" +
          "   </person>" +
          "</employees>", () => {

              init_called.should.equal(true);

              finish_called.should.equal(true);

              (parser as any).obj.should.eql({ name: "John", address: "Paris" });
              done();
          });

    });

    it("should parse a UTF8 encoded xml file with a BOM", function(this: any, done: ErrorCallback) {

        const nodesets = require("node-opcua-nodesets");

        // accommodate for slow RPI
        if (process.arch === "arm") {
            this.timeout(40000);
            this.slow(20000);
        }
        const xml_file = nodesets.standard_nodeset_file;
        const parser = new Xml2Json({});
        parser.parse(xml_file, (err?: Error) => {
            done(err);
        });
    });

    it("should parse a escaped string", (done: ErrorCallback) => {

        let displayName: string | null = null;

        const parser = new Xml2Json({

            parser: {
                DisplayName: {
                    finish(this: any) {
                        displayName = this.text;
                    }
                }
            }
        });

        parser.parseString(
          "<object>" +
          "  <DisplayName>&lt;HelloWorld&gt;</DisplayName>" +
          "</object>", () => {

              displayName!.should.eql("<HelloWorld>");

              done();
          });
    });
});

describe("It should parse XML doc into json", () => {

    it("should parse a simple xml file to json", async () => {

        const parser = new Xml2Json();

        const json = await parser.parseString(
          "<Machine>" +
          "<DisplayName>&lt;HelloWorld&gt;</DisplayName>" +
          "</Machine>");

        json.should.eql(
          {
              machine: {
                  displayName: "<HelloWorld>"
              }
          });

    });

    it("should parse a xml file containing an array to json", async () => {

        const parser = new Xml2Json();

        const json = await parser.parseString(
          `
<Plant>
<ListOfMachines>
<Machine><DisplayName>Machine1</DisplayName></Machine>
<Machine><DisplayName>Machine2</DisplayName></Machine>
<Machine><DisplayName>Machine3</DisplayName></Machine>
<Machine><DisplayName>Machine4</DisplayName></Machine>
</ListOfMachines>
</Plant>
`);

        json.should.eql(
          {
              plant: {
                  machines: [
                      { displayName: "Machine1" },
                      { displayName: "Machine2" },
                      { displayName: "Machine3" },
                      { displayName: "Machine4" }
                  ]
              }
          });

    });

    it("should mix both type of parser", async () => {

        const parser = new Xml2Json({

            parser: {

                person: {
                    init(name: string, attrs: XmlAttributes) {
                        this.parent.root.obj = {};
                        this.obj = this.parent.root.obj;
                        this.obj.name = attrs.name;
                    },

                    finish() {
                        this.obj.should.eql({ name: "John", address: "Paris" });
                    },
                    startElement(elementName: string, attrs: XmlAttributes) {
                        console.log("startElement : elementName ", elementName);
                        this.engine._promote(json_extractor, elementName, attrs);
                    },

                    parser: {
                        address: {
                            finish() {
                                this.parent.obj.address = this.text;
                            }
                        }
                    }
                }
            }
        });

        await parser.parseString(
          `<employees>
             <person name='John'>
               <address>Paris</address>
               <otherStuff>Hello</otherStuff>
             </person>
          </employees>`);

        (parser as any).obj.should.eql({
            name: "John",

            address: "Paris"
        });

    });
});
