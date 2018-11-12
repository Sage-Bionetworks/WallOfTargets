import { Injectable } from '@angular/core';
import { Router, ActivatedRoute, NavigationExtras, ActivationEnd } from '@angular/router';

@Injectable()
export class NavigationService {
    id: string = '';
    // The menu tab that we route to when loading the overview component.
    // Defaults to the first one
    ovMenuTabIndex: number = 0;

    constructor(
        private router: Router,
        private route: ActivatedRoute
    ) {
        this.router.events.subscribe((val) => {
            if (val instanceof ActivationEnd) {
                if (val.snapshot.params && val.snapshot.params.id) {
                    this.id = val.snapshot.params.id;
                }
            }
        });
    }

    goToRoute(path: string, outlets?: any, extras?: NavigationExtras) {
        (outlets) ? this.router.navigate([path, outlets], extras) :
            this.router.navigate([path], extras);
    }

    goToRouteRelative(path: string, outlets?: any) {
        (outlets) ? this.router.navigate([path, outlets], { relativeTo: this.route }) :
            this.router.navigate([path], { relativeTo: this.route });
    }

    getRouter(): Router {
        return this.router;
    }

    getRoute(): ActivatedRoute {
        return this.route;
    }

    getId(): string {
        return this.id;
    }

    getOvMenuTabIndex(): number {
        return this.ovMenuTabIndex;
    }

    setOvMenuTabIndex(index: number) {
        this.ovMenuTabIndex = index;
    }
}
