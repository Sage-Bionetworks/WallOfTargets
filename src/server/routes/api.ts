import { Gene, GeneInfo } from '../../app/models';
import { Genes, GenesInfo, GenesLinks, TeamsInfo } from '../../app/schemas';

import * as express from 'express';
import * as mongoose from 'mongoose';
import * as Grid from 'gridfs';
import * as awsParamStore from 'aws-param-store';

const router = express.Router();
const database = { url: '' };
const env = (process.env.mode || process.env.NODE_ENV || process.env.ENV || 'development');

if (env === 'development') {
    mongoose.set('debug', true);
}

// Set the database url
if (process.env.MONGODB_HOST && process.env.MONGODB_PORT && process.env.APP_ENV) {
    const results = awsParamStore.getParametersSync(
        [
            '/agora-' + process.env.APP_ENV + '/MongodbUsername',
            '/agora-' + process.env.APP_ENV + '/MongodbPassword'
        ], { region: 'us-east-1' }
    );

    database.url = 'mongodb://' + results.Parameters[1]['Value'] + ':'
        + results.Parameters[0]['Value']
        + '@' + process.env.MONGODB_HOST + ':' + process.env.MONGODB_PORT + '/agora'
        + '?authSource=admin';
} else {
    database.url = 'mongodb://localhost:27017/agora';
}

mongoose.connect(database.url, { useNewUrlParser: true });

// Get the default connection
const connection = mongoose.connection;

// Bind connection to error event (to get notification of connection errors)
connection.on('error', console.error.bind(console, 'MongoDB connection error:'));

// Get our grid file system instance
Grid.mongo = mongoose.mongo;

connection.once('open', () => {
    const gfs = Grid(connection.db);

    // Preprocess the data when the server goes up

    // Get the genes collection size
    let tableGenesById: GeneInfo[] = [];
    let tableGenesByNom: GeneInfo[] = [];
    let allGenes: Gene[] = [];
    let totalRecords = 0;
    const allTissues: string[] = [];
    const allModels: string[] = [];

    // Group by id and sort by hgnc_symbol
    Genes.aggregate(
        [
            {
                $sort: {
                    hgnc_symbol: -1,
                    model: 1,
                    tissue: -1
                }
            },
            {
                $group: {
                    _id: '$_id',
                    hgnc_symbol: { $first: '$hgnc_symbol' },
                    ensembl_gene_id: { $first: '$ensembl_gene_id' },
                    logfc: { $first: '$logfc' },
                    fc: { $first: '$fc' },
                    ci_l: { $first: '$ci_l' },
                    ci_r: { $first: '$ci_r' },
                    adj_p_val: { $first: '$adj_p_val' },
                    tissue: { $first: '$tissue' },
                    study: { $first: '$study' },
                    model: { $first: '$model' }
                }
            }
        ]
    ).allowDiskUse(true).exec().then(async (genes) => {
        // All the genes, ordered by hgnc_symbol
        allGenes = genes.slice();
        // Unique genes, ordered by hgnc_symbol
        const seen = {};
        await genes.slice().filter((g) => {
            if (allTissues.indexOf(g['tissue']) === -1) {
                allTissues.push(g['tissue']);
            }
            if (allModels.indexOf(g['model']) === -1) {
                allModels.push(g['model']);
            }
            if (seen[g['hgnc_symbol']]) { return; }
            seen[g['hgnc_symbol']] = true;
            return g['hgnc_symbol'];
        });
        await allTissues.sort();
        await allModels.sort();
    });

    GenesInfo.find({ nominations: { $gt: 0 } })
        .sort({ hgnc_symbol: -1, tissue: -1, model: -1 }).exec(async (err, genes, next) => {
        if (err) {
            next(err);
        } else {
            tableGenesById = genes.slice();
            // Table genes ordered by nominations
            tableGenesByNom = await genes.slice().sort((a, b) => {
                return (a.nominations > b.nominations) ? 1 :
                    ((b.nominations > a.nominations) ? -1 : 0);
            });

            totalRecords = tableGenesById.length;
        }
    });

    /* GET genes listing. */
    router.get('/', (req, res) => {
        res.send({ title: 'Genes API Entry Point' });
    });

    // Routes to get genes information
    router.get('/genes', async (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get all chart genes and current gene entries');
            console.log(req.query.id);
        }

        // Return an empty array in case no id was passed or no params
        if (!req.params || !Object.keys(req.query).length) {
            if (env === 'development') {
                console.log('no id');
            }
            res.json({ item: null });
        } else {
            const fieldName = (req.query.id.startsWith('ENSG')) ? 'ensembl_gene_id' : 'hgnc_symbol';
            const queryObj = { [fieldName]: req.query.id };
            const resObj = {
                items: [],
                geneEntries: []
            };

            // Find all the Genes with the current id
            await Genes.find(queryObj).sort({ hgnc_symbol: 1, tissue: 1, model: 1 })
                .exec(async (err, genes) => {
                if (err) {
                    next(err);
                } else {
                    if (!genes.length) {
                        res.json({items: genes});
                    } else {
                        const chartGenes = allGenes.slice();
                        const geneEntries = genes.slice();
                        const geneTissues = [];
                        const geneModels = [];

                        let minFC: number = +Infinity;
                        let maxFC: number = -Infinity;
                        let minLogFC: number = +Infinity;
                        let maxLogFC: number = -Infinity;
                        let maxAdjPValue: number = -Infinity;
                        let minAdjPValue: number = Infinity;
                        geneTissues.length = 0;
                        geneModels.length = 0;
                        await genes.forEach((g) => {
                            if (+g.fc > maxFC) { maxFC = (+g.fc); }
                            if (+g.fc < minFC) { minFC = (+g.fc); }
                            if (+g.logfc > maxLogFC) { maxLogFC = (+g.logfc); }
                            if (+g.logfc < minLogFC) { minLogFC = (+g.logfc); }
                            const adjPVal: number = +g.adj_p_val;
                            if (+g.adj_p_val) {
                                if (adjPVal > maxAdjPValue) {
                                    maxAdjPValue = adjPVal;
                                }
                                if (adjPVal < minAdjPValue) {
                                    minAdjPValue = (adjPVal) < 1e-20 ? 1e-20 : adjPVal;
                                }
                            }
                            if (g.tissue && geneTissues.indexOf(g.tissue) === -1) {
                                geneTissues.push(g.tissue);
                            }
                            if (g.model && geneModels.indexOf(g.model) === -1) {
                                geneModels.push(g.model);
                            }
                        });
                        await geneTissues.sort();
                        await geneModels.sort();

                        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                        res.setHeader('Pragma', 'no-cache');
                        res.setHeader('Expires', 0);
                        await res.json({
                            items: chartGenes,
                            geneEntries,
                            minFC: (Math.abs(maxFC) > Math.abs(minFC)) ? -maxFC : minFC,
                            maxFC,
                            minLogFC: (Math.abs(maxLogFC) > Math.abs(minLogFC)) ?
                                -maxLogFC : minLogFC,
                            maxLogFC,
                            minAdjPValue,
                            maxAdjPValue,
                            geneModels,
                            geneTissues
                        });
                    }
                }
            });
        }
    });

    // Use mongoose to get one page of genes
    router.get('/genes/page', (req, res) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get a page of genes');
            console.log(req.query);
        }

        // Convert the strings
        const skip = (+req.query.first) ? +req.query.first : 0;
        const limit = (+req.query.rows) ? +req.query.rows : 10;

        // Get one array or the other depending on the list column we want to sort by
        let genes: GeneInfo[] = [];

        if (req.query.globalFilter !== 'null' && req.query.globalFilter) {
            ((req.query.sortField === 'nominations') ? tableGenesByNom : tableGenesById).forEach(
                (g) => {
                // If we typed into the search above the list
                if (g.hgnc_symbol.includes(req.query.globalFilter.trim().toUpperCase()))  {
                    // Do not use a shallow copy here
                    genes.push(JSON.parse(JSON.stringify(g)));
                }
            });
        } else {
            genes = ((req.query.sortField === 'nominations') ? tableGenesByNom :
                tableGenesById).slice();
        }
        // Updates the global length based on the filter
        totalRecords = genes.length;

        // If we want sort in the reverse order, this is done in-place
        const sortOrder = (+req.query.sortOrder) ? +req.query.sortOrder : 1;
        if (sortOrder === -1) { genes.reverse(); }

        // Send the final genes page
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', 0);
        res.json({ items: genes.slice(skip, skip + limit), totalRecords });
    });

    // Use mongoose to get all pages for the table
    router.get('/genes/table', (req, res) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get a page of genes');
            console.log(req.query);
        }

        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', 0);
        res.json({ items: tableGenesById, totalRecords: tableGenesById.length });
    });

    // Get all gene infos that match an id, using the hgnc_symbol or ensembl id
    router.get('/gene/infos/:id', (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get the genes that match an id');
            console.log(req.params.id);
        }

        const fieldName = (req.params.id.startsWith('ENSG')) ? 'ensembl_gene_id' : 'hgnc_symbol';
        const isEnsembl = (req.params.id.startsWith('ENSG')) ? true : false;
        const queryObj = { [fieldName]: { $regex: req.params.id.trim(), $options: 'i' } };

        // Return an empty array in case no id was passed or no params
        if (!req.params || !req.params.id) {
            res.json({ items: [], isEnsembl });
        } else {
            GenesInfo.find(queryObj).exec(
                (err, geneInfos) => {
                    if (err) {
                        next(err);
                    } else {
                        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                        res.setHeader('Pragma', 'no-cache');
                        res.setHeader('Expires', 0);
                        res.json({ items: geneInfos, isEnsembl });
                    }
                });
        }
    });

    // Get all genes infos that match an array of ids, currently hgnc_symbol
    router.get('/mgenes/infos', (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get the genes that match multiple ids');
        }

        // Return an empty array in case no id was passed or no params
        if (!req.query || !req.query.ids) { res.json({ items: [] });
        } else {
            const ids = req.query.ids.split(',');

            GenesInfo.find({ ensembl_gene_id: { $in: ids } }).exec(
                (err, geneInfos) => {
                    if (err) {
                        next(err);
                    } else {
                        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                        res.setHeader('Pragma', 'no-cache');
                        res.setHeader('Expires', 0);
                        res.json({ items: geneInfos });
                    }
                });
        }
    });

    // Get a gene by id, can be hgnc_symbol or ensembl_gene_id
    router.get('/gene', async (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get a gene with an id');
            console.log(req.query.id);
        }

        // Return an empty array in case no id was passed or no params
        if (!req.params || !Object.keys(req.query).length) {
            if (env === 'development') {
                console.log('no id');
            }
            res.json({ item: null });
        } else {
            const fieldName = (req.query.id.startsWith('ENSG')) ? 'ensembl_gene_id' : 'hgnc_symbol';
            const queryObj = { [fieldName]: req.query.id };

            if (req.query.tissue) {
                queryObj['tissue'] = req.query.tissue;
            }
            if (req.query.model) {
                queryObj['model'] = req.query.model;
            }

            // Find all the Genes with the current id
            await Genes.findOne(queryObj).exec(async (err, gene) => {
                if (err) {
                    next(err);
                } else {
                    const item = gene;

                    await GenesInfo.findOne({ [fieldName]: req.query.id }).exec(
                        async (errB, info) => {
                        if (errB) {
                            next(errB);
                        } else {
                            // Adding this condition because UglifyJS can't handle ES2015,
                            // only needed for the server
                            if (env === 'development') {
                                console.log('The gene info and item');
                                console.log(info);
                                console.log(item);
                            }

                            res.setHeader(
                                'Cache-Control', 'no-cache, no-store, must-revalidate'
                            );
                            res.setHeader('Pragma', 'no-cache');
                            res.setHeader('Expires', 0);
                            await res.json({
                                info,
                                item
                            });
                        }
                    });
                }
            });
        }
    });

    // Get a gene list by id
    router.get('/genelist/:id', (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get a gene list with an id');
            console.log(req.params.id);
        }

        // Return an empty array in case no id was passed or no params
        if (!req.params || !req.params.id) { res.json({ items: [] }); } else {
            GenesLinks.find({ geneA_ensembl_gene_id: req.params.id }).exec(async (err, links) => {
                const arrA = await links.slice().map((slink) => {
                    return slink.toJSON()['geneB_ensembl_gene_id'];
                });

                GenesLinks.find({ geneB_ensembl_gene_id: req.params.id }, async (errB, linkB) => {
                    const arrB = await linkB.slice().map((slink) => {
                        return slink.toJSON()['geneA_ensembl_gene_id'];
                    });
                    const arr = [...arrA, ...arrB];
                    GenesLinks.find({ geneA_ensembl_gene_id: { $in: arr } })
                        .where('geneB_ensembl_gene_id')
                        .in(arr)
                        .exec((errC, linksC) => {
                            if (errC) {
                                next(errC);
                            } else {
                                const flinks = [...links, ...linkB, ...linksC];
                                res.setHeader(
                                    'Cache-Control', 'no-cache, no-store, must-revalidate'
                                );
                                res.setHeader('Pragma', 'no-cache');
                                res.setHeader('Expires', 0);
                                res.json({ items: flinks });
                            }
                        });
                });
            });
        }
    });

    // Get a team by team field
    router.get('/teams', (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get a team from a nominated gene');
            console.log(req.query);
        }

        // Return an empty array in case no id was passed or no params
        if (!req.params || !Object.keys(req.query).length) { res.json({ items: [] }); } else {
            const arr = req.query.teams.split(', ');

            TeamsInfo.find({ team: { $in: arr } }).exec((err, team) => {
                if (err) {
                    next(err);
                } else {
                    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                    res.setHeader('Pragma', 'no-cache');
                    res.setHeader('Expires', 0);
                    res.json({ items: team });
                }
            });
        }
    });

    // Get all team infos
    router.get('/teams/all', (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get all team infos');
        }

        TeamsInfo.find().exec((err, teams) => {
            if (err) {
                next(err);
            } else {
                res.json(teams);
            }
        });
    });

    router.get('/team/image', async (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get a team member image');
            console.log(req.query);
        }

        // Return an empty array in case no id was passed or no params
        if (!req.params || !Object.keys(req.query).length) { res.json({ item: null }); } else {
            const name = req.query.name.toLowerCase().replace(/[- ]/g, '_') + '.jpg';
            gfs.exist({ filename: name }, (err, hasFile) => {
                if (hasFile) {
                    if (env === 'development') {
                        console.log('The team file exists jpg');
                        console.log(name);
                        console.log(hasFile);
                    }
                    const stream = gfs.createReadStream(name);
                    stream.pipe(res);
                } else {
                    if (env === 'development') {
                        console.log('The team file isnt jpg');
                    }
                    const NAMEJPEG = req.query.name.toLowerCase().replace(/[- ]/g, '_') + '.jpeg';
                    gfs.exist({ filename: NAMEJPEG }, (err2, hasFile2) => {
                        if (hasFile2) {
                            if (env === 'development') {
                                console.log('The team file exists jpeg');
                                console.log(NAMEJPEG);
                                console.log(hasFile);
                            }
                            const stream = gfs.createReadStream(NAMEJPEG);
                            stream.pipe(res);
                        } else {
                            if (env === 'development') {
                                console.log('The team file isnt jpeg');
                            }
                            const namePNG = req.query.name
                            .toLowerCase().replace(/[- ]/g, '_') + '.png';
                            gfs.exist({ filename: namePNG }, (err3, hasFile3) => {
                                if (hasFile3) {
                                    if (env === 'development') {
                                        console.log('The team file exists png');
                                        console.log(namePNG);
                                        console.log(hasFile);
                                    }
                                    const stream = gfs.createReadStream(namePNG);
                                    stream.pipe(res);
                                } else {
                                    if (env === 'development') {
                                        console.log('The team file isnt png');
                                    }
                                    console.log(name, NAMEJPEG, namePNG);
                                    res.status(204).send('Could not find member!');
                                }
                            });
                        }
                    });
                }
            });
        }
    });

    // Get all the tissues
    router.get('/tissues', (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get all tissues');
            console.log(allTissues);
        }

        // Return an empty array in case we don't have tissues
        if (!allTissues.length) { res.json({ items: [] }); } else {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', 0);
            res.json({ items: allTissues });
        }
    });

    // Get all the gene tissues
    router.get('/tissues/gene', async (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get gene tissues with an id');
            console.log(req.query.id);
        }

        // Return an empty array in case no id was passed or no params
        if (!req.params || !Object.keys(req.query).length) {
            if (env === 'development') {
                console.log('no id');
            }
            res.json({ item: null });
        } else {
            const fieldName = (req.query.id.startsWith('ENSG')) ? 'ensembl_gene_id' : 'hgnc_symbol';
            const queryObj = { [fieldName]: req.query.id };

            // Find all the Genes with the current id
            await Genes.find(queryObj).sort({ hgnc_symbol: 1, tissue: 1, model: 1 })
                .exec(async (err, genes) => {
                if (err) {
                    next(err);
                } else {
                    if (!genes.length) {
                        res.status(404).send('No genes found!');
                    } else {
                        const geneTissues = await genes.slice().map((gene) => {
                            return gene.tissue;
                        });
                        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                        res.setHeader('Pragma', 'no-cache');
                        res.setHeader('Expires', 0);
                        res.json({ items: geneTissues });
                    }
                }
            });
        }
    });

    // Get all the models
    router.get('/models', (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get all models');
            console.log(allModels);
        }

        // Return an empty array in case we don't have models
        if (!allModels.length) { res.json({ items: [] }); } else {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', 0);
            res.json({ items: allModels });
        }
    });

    // Get all the models
    router.get('/models/gene', async (req, res, next) => {
        // Adding this condition because UglifyJS can't handle ES2015, only needed for the server
        if (env === 'development') {
            console.log('Get gene tissues with an id');
            console.log(req.query.id);
        }

        // Return an empty array in case no id was passed or no params
        if (!req.params || !Object.keys(req.query).length) {
            if (env === 'development') {
                console.log('no id');
            }
            res.json({ item: null });
        } else {
            const fieldName = (req.query.id.startsWith('ENSG')) ? 'ensembl_gene_id' : 'hgnc_symbol';
            const queryObj = { [fieldName]: req.query.id };

            // Find all the Genes with the current id
            await Genes.find(queryObj).sort({ hgnc_symbol: 1, tissue: 1, model: 1 })
                .exec(async (err, genes) => {
                if (err) {
                    next(err);
                } else {
                    if (!genes.length) {
                        res.status(404).send('No genes found!');
                    } else {
                        const geneModels = await genes.slice().map((gene) => {
                            return gene.model;
                        });
                        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                        res.setHeader('Pragma', 'no-cache');
                        res.setHeader('Expires', 0);
                        res.json({ items: geneModels });
                    }
                }
            });
        }
    });
});

export default router;
