/**
* Template object to pass server parameters to client side
* 
* @public
*/
interface IUrlLocation {
    /**
     * The string value of URL fragment after the # character, or an emptry string if no URL fragment is present
     */
    hash: string;
    /**
     * An object of key/value pairs that correspond to the URL request parameters. Only the first value will be returned for parameters that have multiple values. If no parameters are present, this will be an empty object.
     */
    parameter: { [key: string]: any; };
    /*
     * An object similar to location.parameter, but with an array of values for each key. If no parameters are present, this will be an empty object.
     */
    parameters: { [key: string]: any[]; };
}

/**
 * 
 * @public
 * google.script.url is an asynchronous client-side JavaScript API that can query URLs to obtain the current URL parameters and fragment. This API supports the google.script.history API. It can only be used in the context of a web app that uses IFRAME.
 */
interface url {
    /**
     */
    getLocation(callback: (location: IUrlLocation) => void): void;
}