import deepmerge from 'deepmerge';

import * as Router from '../common/router/Router';
import * as errors from '../common/router/errors';

export default class ClientRouter {
    errors = errors;

    #currentUrl;
    #singleSpa;
    #location;
    #logger;
    #registryConf;
    /** @type Object<Router> */
    #router;
    #prevRoute;
    #currentRoute;
    #windowEventHandlers = {};
    #forceSpecialRoute = null;

    constructor(registryConf, state, singleSpa, location = window.location, logger = window.console) {
        this.#singleSpa = singleSpa;
        this.#location = location;
        this.#logger = logger;
        this.#registryConf = registryConf;
        this.#router = new Router(registryConf);
        this.#currentUrl = this.#getCurrUrl();

        this.#setInitialRoutes(state);
        this.#addEventListeners();
    }

    getPrevRoute = () => this.#prevRoute;
    getCurrentRoute = () => this.#currentRoute;

    getPrevRouteProps = (appName, slotName) => this.#getRouteProps(appName, slotName, this.#prevRoute);
    getCurrentRouteProps = (appName, slotName) => this.#getRouteProps(appName, slotName, this.#currentRoute);

    #getRouteProps(appName, slotName, route) {
        if (this.#registryConf.apps[appName] === undefined) {
            throw new this.errors.RouterError({message: 'Can not find info about the app.', data: {appName}});
        }

        if (route.slots[slotName] === undefined) {
            throw new this.errors.RouterError({message: 'Can not find info about the slot.', data: {slotName}});
        }

        const appProps = this.#registryConf.apps[appName].props || {};
        const routeProps = route.slots[slotName].props || {};

        return deepmerge(appProps, routeProps);
    }

    #setInitialRoutes = (state) => {
        // we should respect base tag for cached pages
        const base = document.querySelector('base');
        if (base) {
            const a = document.createElement('a');
            a.href = base.getAttribute('href');
            this.#currentRoute = this.#router.match(a.pathname + a.search);

            base.remove();
            this.#logger.warn(
                'ILC: <base> tag was used only for initial rendering and removed afterwards.\n' +
                'Currently, ILC does not support it fully.\n' +
                'Please open an issue if you need this functionality.'
            );
        } else if (state.forceSpecialRoute === '404') {
            this.#currentRoute = this.#router.matchSpecial(this.#getCurrUrl(), state.forceSpecialRoute);
        } else {
            this.#currentRoute = this.#router.match(this.#getCurrUrl());
        }

        this.#prevRoute = this.#currentRoute;
    };

    #addEventListeners = () => {
        this.#windowEventHandlers['ilc:before-routing'] = this.#onSingleSpaRoutingEvents;
        this.#windowEventHandlers['ilc:404'] = this.#onSpecialRouteTrigger(404);

        for (let key in this.#windowEventHandlers) {
            if (!this.#windowEventHandlers.hasOwnProperty(key)) {
                continue;
            }

            window.addEventListener(key, this.#windowEventHandlers[key]);
        }

        document.addEventListener('click', this.#onClickLink);
    };

    removeEventListeners() {
        for (let key in this.#windowEventHandlers) {
            if (!this.#windowEventHandlers.hasOwnProperty(key)) {
                continue;
            }

            window.removeEventListener(key, this.#windowEventHandlers[key]);
        }
        this.#windowEventHandlers = {};

        document.removeEventListener('click', this.#onClickLink);
    }

    #onSingleSpaRoutingEvents = () => {
        this.#prevRoute = this.#currentRoute;

        const newUrl = this.#getCurrUrl();
        if (this.#forceSpecialRoute !== null && this.#forceSpecialRoute.url === newUrl) {
            this.#currentRoute = this.#router.matchSpecial(newUrl, this.#forceSpecialRoute.id);
        } else if (this.#forceSpecialRoute !== null) {
            // Reset variable if it was set & now we go to different route
            this.#forceSpecialRoute = null;
        }

        // fix for google cached pages.
        // if open any cached page and scroll to "#features" section:
        // only hash will be changed so router.match will return error, since <base> tag has already been removed.
        // so in this cases we shouldn't regenerate currentRoute
        if (this.#currentUrl !== newUrl) {
            this.#currentRoute = this.#router.match(this.#location.pathname + this.#location.search);
            this.#currentUrl = newUrl;
        }

        if (this.#currentRoute && this.#prevRoute.template !== this.#currentRoute.template) {
            throw new this.errors.RouterError({
                message:
                    'Base template was changed.\n' +
                    'Currently, ILC does not handle it.\n' +
                    'Please open an issue if you need this functionality.',
                data: {
                    prevTemplate: this.#prevRoute.template,
                    currentTemplate: this.#currentRoute.template
                },
            });
        }
    };

    #onClickLink = (event) => {
        const anchor = event.target.tagName === 'A'
            ? event.target
            : event.target.closest('a');
        const href = anchor && anchor.getAttribute('href');

        if (event.defaultPrevented || !href) {
            return;
        }

        const pathname = href.replace(this.#location.origin, '');
        const {specialRole} = this.#router.match(pathname);

        if (specialRole === null) {
            this.#singleSpa.navigateToUrl(href);
            event.preventDefault();
        }
    };

    #onSpecialRouteTrigger = (specialRouteId) => (e) => {
        const appId = e.detail && e.detail.appId;
        const mountedApps = this.#singleSpa.getMountedApps();
        if (!mountedApps.includes(appId)) {
            return console.warn(
                `ILC: Ignoring special route "${specialRouteId}" trigger which came from not mounted app "${appId}". ` +
                `Currently mounted apps: ${mountedApps.join(', ')}.`
            );
        }

        console.log(`ILC: Special route "${specialRouteId}" was triggered by "${appId}" app. Performing rerouting...`);
        this.#forceSpecialRoute = {id: specialRouteId, url: this.#getCurrUrl()};
        this.#singleSpa.triggerAppChange(); //This call would immediately invoke "single-spa:before-routing-event" and start apps mount/unmount process
    };

    #getCurrUrl = () => this.#location.pathname + this.#location.search;
}
