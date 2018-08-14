import { NgModule } from '@angular/core';
import { CommonModule, DecimalPipe, TitleCasePipe } from '@angular/common';

import { AppSharedModule } from '../shared';
import { CoreRoutingModule } from './core-routing.module';

// PrimeNG modules
import { ButtonModule } from 'primeng/button';
import { SplitButtonModule } from 'primeng/splitbutton';
import { MenuModule } from 'primeng/menu';
import { MenubarModule } from 'primeng/menubar';
import { PanelMenuModule } from 'primeng/panelmenu';
import { TieredMenuModule } from 'primeng/tieredmenu';

import {
    AuthGuardService,
    AuthenticationService,
    GeneService,
    DataService
} from './services';

import { AboutComponent } from './about';
import { TermsComponent } from './terms';
import { SynapseAccountComponent } from './synapse-account';
import { BetaBannerComponent } from './beta-banner';
import { NavbarComponent } from './navbar';
import { MenubarComponent } from './menubar';
import { FooterComponent } from './footer';
import { NoContentComponent } from './no-content';

import '../../styles/styles.scss';
import '../../styles/headings.css';
import { ContribTeamsPageComponent } from './contrib-teams';
import { ProgressBarModule } from '../../../node_modules/primeng/primeng';

@NgModule({
    imports: [
        // Angular modules
        CommonModule,
        // PrimeNG modules
        ButtonModule,
        ProgressBarModule,
        SplitButtonModule,
        MenuModule,
        MenubarModule,
        TieredMenuModule,
        PanelMenuModule,
        // Shared and route modules
        AppSharedModule.forRoot(),
        CoreRoutingModule
    ],
    declarations: [
        NavbarComponent,
        MenubarComponent,
        FooterComponent,
        NoContentComponent,
        AboutComponent,
        TermsComponent,
        ContribTeamsPageComponent,
        SynapseAccountComponent,
        BetaBannerComponent
    ],
    exports: [
        // Exported components
        NavbarComponent,
        MenubarComponent,
        FooterComponent,
        AboutComponent,
        TermsComponent,
        ContribTeamsPageComponent,
        SynapseAccountComponent,
        BetaBannerComponent
    ],
    providers: [
        AuthenticationService,
        AuthGuardService,
        DataService,
        GeneService,
        DecimalPipe,
        TitleCasePipe
    ]
})
export class CoreModule { }