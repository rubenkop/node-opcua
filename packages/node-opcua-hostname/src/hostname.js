"use strict";
const os = require("os");

const trim = function (str, length) {
    if (!length) {
        return str;
    }
    return str.substr(0, Math.min(str.length, length));
};

let _fully_qualified_domain_name_cache = null;

function get_fully_qualified_domain_name(optional_max_length) {
    if (_fully_qualified_domain_name_cache) {
        return trim(_fully_qualified_domain_name_cache, optional_max_length);
    }
    if (process.platform === "win32") {

        // http://serverfault.com/a/73643/251863
        const env = process.env;
        _fully_qualified_domain_name_cache = env.COMPUTERNAME + ( (env.USERDNSDOMAIN && env.USERDNSDOMAIN.length > 0) ? "." + env.USERDNSDOMAIN : "");

    } else {

        try {
            let fqdn = require("node-fqdn");
            _fully_qualified_domain_name_cache = fqdn();
            if (/sethostname/.test(_fully_qualified_domain_name_cache)) {
                throw new Error("Detecting fqdn  on windows !!!");
            }

        } catch (err) {
            // fall back to old method
            _fully_qualified_domain_name_cache = os.hostname();
        }

    }
    return trim(_fully_qualified_domain_name_cache, optional_max_length);
}
// note : under windows ... echo %COMPUTERNAME%.%USERDNSDOMAIN%
exports.get_fully_qualified_domain_name = get_fully_qualified_domain_name;
