/**
 * @module node-opcua-xml2json
 * node -> see if https://github.com/isaacs/sax-js could be used instead
 */

// tslint:disable:max-classes-per-file
// tslint:disable:no-var-requires
// tslint:disable:unified-signatures

import * as fs from "fs";
import { assert } from "node-opcua-assert";
import { lowerFirstLetter } from "node-opcua-utils";
import * as _ from "underscore";

const LtxParser = require("ltx/lib/parsers/ltx.js");

export type SimpleCallback = (err?: Error) => void;
export type Callback<T> = (err?: Error | null, result?: T) => void;

declare interface LtxParser {
    write(str: string): void;

    end(): void;

    on(eventName: "startElement", eventHandler: (name: string, attrs: XmlAttributes) => void): void;

    on(eventName: "endElement", eventHandler: (name: string) => void): void;

    on(eventName: "text", eventHandler: (name: string) => void): void;

    on(eventName: "close", eventHandler: () => void): void;

}

export interface Parser {
    [key: string]: ReaderState;
}

/**
 * @static
 * @private
 * @method _coerceParser
 * @param parser {map<ReaderState|options>}
 * @return {map}
 */
function _coerceParser(parser: ParserLike): Parser {

    for (const name of Object.keys(parser)) {
        if (parser[name] && !(parser[name] instanceof ReaderState)) {
            // this is to prevent recursion
            const tmp = parser[name];
            delete parser[name];
            parser[name] = new ReaderState(tmp);
        }
    }
    return parser as Parser;
}

export interface XmlAttributes {
    [key: string]: string;
}

export interface ReaderStateParser {
    parser?: ParserLike;
    init?: (this: any, name: string, attrs: XmlAttributes) => void;
    finish?: (this: any) => void;
    startElement?: (this: any, name: string, attrs: XmlAttributes) => void;
    endElement?: (this: any, name: string) => void;
}

export interface ParserLike {
    [key: string]: ReaderStateParserLike;
}

export interface ReaderStateParserLike {
    parser?: ParserLike;
    init?: (this: any, name: string, attrs: XmlAttributes) => void;
    finish?: (this: any) => void;
    startElement?: (this: any, name: string, attrs: XmlAttributes) => void;
    endElement?: (this: any, name: string) => void;
}

export interface IReaderState {

    _on_init(
      elementName: string,
      attrs: XmlAttributes,
      parent: IReaderState,
      engine: Xml2Json): void;

    _on_startElement(elementName: string, attrs: XmlAttributes): void;

    _on_endElement(elementName: string): void;

    _on_text(text: string): void;
}

/**
 * @class ReaderState
 * @private
 * @param options
 * @param [options.parser=null]  {map<ReaderState|options}}
 * @param [options.init|null]
 * @param [options.finish]
 * @param [options.startElement]
 * @param [options.endElement]
 */
export class ReaderState implements IReaderState {

    public _init?: (name: string, attrs: XmlAttributes) => void;
    public _finish?: () => void;
    public _startElement?: (name: string, attrs: XmlAttributes) => void;
    public _endElement?: (name: string) => void;

    public parser: any;
    public attrs?: XmlAttributes;
    public chunks: any[] = [];
    public text: string = "";
    public name?: string = "";

    public engine?: Xml2Json;

    public parent?: IReaderState;
    public root?: Xml2Json;
    public data?: any;

    constructor(options: ReaderStateParser) {

        // ensure options object has only expected properties
        options.parser = options.parser || {};

        if (!(options instanceof ReaderState)) {

            const fields = _.keys(options);
            const invalid_fields = _.difference(fields, ["parser", "init", "finish", "startElement", "endElement"]);

            /* istanbul ignore next*/
            if (invalid_fields.length !== 0) {
                // tslint:disable:no-console
                console.log(" Invalid fields detected :", invalid_fields);
                throw new Error("Invalid filed detected in ReaderState Parser !:" + invalid_fields.join(" - "));
            }
        }

        this._init = options.init;
        this._finish = options.finish;
        this._startElement = options.startElement;
        this._endElement = options.endElement;
        this.parser = _coerceParser(options.parser);
    }

    /**
     * @method _on_init
     * @param elementName  - the name of the element
     * @param attrs
     * @protected
     */
    public _on_init(
      elementName: string,
      attrs: XmlAttributes,
      parent: IReaderState,
      engine: Xml2Json
    ) {
        this.name = elementName;
        this.parent = parent;
        this.engine = engine;
        this.data = {};

        this.attrs = attrs;
        assert(this.attrs);
        if (this._init) {
            this._init(elementName, attrs);
        }
    }

    /**
     * @method _on_startElement
     * @param elementName   - the name of the element
     * @param attrs
     * @protected
     */
    public _on_startElement(elementName: string, attrs: XmlAttributes) {
        this.chunks = [];
        this.text = "";
        if (this.engine && this.parser.hasOwnProperty(elementName)) {
            this.engine._promote(
              this.parser[elementName], elementName, attrs);
        } else if (this._startElement) {
            this._startElement(elementName, attrs);
        }
    }

    /**
     * @method _on_endElement
     * @protected
     */
    public _on_endElement(elementName: string): void {

        assert(this.attrs);

        this.chunks = this.chunks || [];

        if (elementName === this.name) {
            if (this._finish) {
                this.text = this.chunks.join("");
                this.chunks = [];
                this._finish();
            }
        }

        /*
                if (this.parent && this.parent._endElement) {
                    this.parent._endElement(elementName);
                }
         */
        if (this.parent && this.parent._on_endElement) {
            this.parent._on_endElement(elementName);
        }

        if (elementName === this.name) {
            // this is the end
            this.engine!._demote(this);
        }
    }

    /**
     * @method _on_text
     * @param text {String} the text found inside the element
     * @protected
     */
    public _on_text(text: string): void {
        this.chunks = this.chunks || [];
        text = text.trim();
        if (text.length === 0) {
            return;
        }
        this.chunks.push(text);
    }

}

const regexp = /(([^:]+):)?(.*)/;

function resolve_namespace(name: string) {
    const m = name.match(regexp);
    if (!m) {
        throw new Error("Invalid match");
    }
    return {
        ns: m[2],
        tag: m[3]
    };
}

/**
 * @class Xml2Json
 * @param options - the state machine as  a ReaderState node.
 * @param [options.parser=null]  {ReaderState}
 * @param [options.init|null]
 * @param [options.finish]
 * @param [options.startElement]
 * @param [options.endElement]
 * @constructor
 *
 * @example
 *  var parser = new Xml2Json({
 *       parser: {
 *           'person': {
 *               init: function(name,attrs) {
 *                   this.parent.root.obj = {};
 *                   this.obj =  this.parent.root.obj;
 *                   this.obj['name'] = attrs['name'];
 *               },
 *               parser: {
 *                   'address': {
 *                       finish: function(){
 *                           this.parent.obj['address'] = this.text;
 *                       }
 *                   }
 *               }
 *           }
 *       }
 *   });
 *
 * var xml_string =  "<employees>" +
 * "  <person name='John'>" +
 * "     <address>Paris</address>" +
 * "   </person>" +
 * "</employees>";
 *
 * parser.parseString(xml_string, function() {
 *       parser.obj.should.eql({name: 'John',address: 'Paris'});
 *       done();
 *   });
 */
export class Xml2Json {

    private state_stack: any[] = [];
    private current_state: any = null;

    constructor(options?: ReaderStateParser) {

        if (!options) {
            this.state_stack = [];
            this.current_state = null;
            this._promote(json_extractor);
            return;
        }
        const state = (options instanceof ReaderState)
          ? options as ReaderState : new ReaderState(options);
        state.root = this;

        this.state_stack = [];
        this.current_state = null;
        this._promote(state);
    }

    /**
     * @method parseString
     * @async
     */
    public parseString(xml_text: string): Promise<any>;
    public parseString(xml_text: string, callback: Callback<any> | SimpleCallback): void;
    public parseString(xml_text: string, callback?: Callback<any> | SimpleCallback): any {
        const parser = this._prepareParser(callback!);
        parser.write(xml_text);
        parser.end();
    }

    /**
     * @method  parse
     * @async
     * @param xmlFile - the name of the xml file to parse.
     */
    public parse(xmlFile: string): Promise<any>;
    public parse(xmlFile: string, callback: Callback<any> | SimpleCallback): void;
    public parse(xmlFile: string, callback?: Callback<any> | SimpleCallback): any {

        if (!callback) {
            throw new Error("internal error");
        }
        const readWholeFile = true;
        if (readWholeFile) {

            // slightly faster but require more memory ..
            fs.readFile(xmlFile, (err: Error | null, data: Buffer) => {
                if (err) {
                    return callback(err);
                }
                if (data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
                    data = data.slice(3);
                }
                const dataAsString = data.toString();
                const parser = this._prepareParser(callback);
                parser.write(dataAsString);
                parser.end();
            });
        } else {

            const Bomstrip = require("bomstrip");

            const parser = this._prepareParser(callback);

            fs.createReadStream(xmlFile, { autoClose: true, encoding: "utf8" })
              .pipe(new Bomstrip())
              .pipe(parser);

        }
    }

    /**
     * @param new_state
     * @param name
     * @param attr
     * @private
     * @internal
     */
    public _promote(new_state: IReaderState, name?: string, attr?: XmlAttributes) {
        console.log(" Promote : name", name!);
        attr = attr || {};
        this.state_stack.push({
            backup: {},
            state: this.current_state
        });

        const parent = this.current_state;
        this.current_state = new_state;
        this.current_state._on_init(name, attr, parent, this);
    }

    /**
     *
     * @param cur_state
     * @private
     * @internal
     */
    public _demote(cur_state: IReaderState) {
        console.log(" demote : name",(cur_state as any).name);

      ///  assert(this.current_state === cur_state);
        const { state, backup } = this.state_stack.pop();
        this.current_state = state;
    }

    private _prepareParser(callback: Callback<any> | SimpleCallback): LtxParser {

        const parser = new LtxParser();
        let c = 0;
        parser.on("startElement", (name: string, attrs: XmlAttributes) => {
            const tag_ns = resolve_namespace(name);
            this.current_state._on_startElement(tag_ns.tag, attrs);
            c += 1;
        });
        parser.on("endElement", (name: string) => {
            const tag_ns = resolve_namespace(name);
            this.current_state._on_endElement(tag_ns.tag);
            c -= 1;
            if (c === 0) {
                parser.emit("close");
            }
        });
        parser.on("text", (text: string) => {
            text = text.trim();
            if (text.length === 0) {
                return;
            }
            this.current_state._on_text(text);
        });
        parser.on("close",
          () => {
            if (callback) {
                (callback as any)(null, this.current_state._pojo);
            }
        });
        return parser;
    }
}

class ReaderState2 implements IReaderState {
    public _stack: any;
    public _pojo: any;
    public _element: any;
    public text: string;

    private parent?: IReaderState;
    private engine?: Xml2Json;

    constructor() {
        this._pojo = {};
        this._stack = [];
        this._element = {};
        this.text = "";
        this.parent = undefined;
    }

    public _on_init(
      elementName: string,
      attrs: XmlAttributes,
      parent: IReaderState,
      engine: Xml2Json
    ): void {

        this.parent = parent;
        this.engine = engine;
        if (this._stack.length === 0) {
            this._pojo = {};
            this._element = this._pojo;
        }
    }

    public _on_startElement(elementName: string, attrs: XmlAttributes): void {

        this._stack.push(this._element);

        if (elementName.match(/^ListOf/)) {
            elementName = elementName.substring(6);
            const elName = lowerFirstLetter(elementName);
            if (this._element instanceof Array) {
                const array: any[] = [];
                this._element.push(array);
                this._element = array;
            } else {
                this._element[elName] = [];
                this._element = this._element[elName];
            }
        } else {
            const elName = lowerFirstLetter(elementName);
            if (this._element instanceof Array) {
                const obj = {};
                this._element.push(obj);
                this._element = obj;
            } else {
                this._element[elName] = {};
                this._element = this._element[elName];
            }
        }

    }

    public _on_endElement(elementName: string): void {
        this._element = this._stack.pop();
        if (this.text.length > 0 &&  this._element) {
            const elName = lowerFirstLetter(elementName);
            this._element[elName] = this.text;
            this.engine!._demote(this);

        }
        this.text = "";
    }

    public _on_text(text: string): void {
        this.text = text;
    }

}

export const json_extractor: IReaderState = new ReaderState2();

// tslint:disable:no-var-requires
const thenify = require("thenify");
const opts = { multiArgs: false };
Xml2Json.prototype.parseString =
  thenify.withCallback(Xml2Json.prototype.parseString, opts);
Xml2Json.prototype.parse =
  thenify.withCallback(Xml2Json.prototype.parse, opts);
