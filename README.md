Table of Contents
=======================

* [What is itwin-pcf?](#what-is-itwin-pcf)
* [Why use itwin-pcf?](#why-use-itwin-pcf)
* [Constructs](#constructs)
* [Getting started](#getting-started)
* [What you should know](#what-you-should-know)
* [Advance Topics](#advance-topics)
  * [What is the difference between a Connector and a Loader?](#what-is-the-difference-between-a-connector-and-a-loader)
  * [How to write a Loader?](#how-to-write-a-loader)
* [Contributing](#contributing)
* [Road Map](#road-map)

# What is itwin-pcf?


itwin-pcf is tool for synchronizing external data with your digital twin, iModel, deterministically and efficiently. As opposed to traditional [iModel Connectors](https://www.itwinjs.org/learning/imodel-connectors/), itwin-pcf allows you to **define** your iModel as code then it takes care of the steps to reach that goal. With pcf, you have the full control over how you would like your data to land in an iModel with minimal efforts.


# Why use itwin-pcf?


## Declarative Synchronization
pcf allows you to define an entire synchronization job with two constructs: **DMO's** and **Nodes** (see definitions below). It handles the necessary logic & topological order of inserting/updating/deleting elements and relationships into an iModel.


## Minimized Runtime Error & Testing
Given that **DMO** and **Nodes** are the main inputs to your connector, so long as their definitions are correct, your synchronization job is guaranteed to succeed with pcf. 

To minimize runtime errors, your inputs are strictly checked both at compile time and runtime before your synchronization job actually gets executed by pcf (Most errors are caught at compile time by TypeScript interface linting). Functionalities such as code-completion and code-refactoring available in most modern IDE's (e.g Visual Studio Code) will help you to write the correct definitions for them. Since most runtime errors are avoided at compile time and pcf is rigorously tested, you don't have to write any tests for your connector.


## Single Source of Truth (SSOT)

As both of your connector and source data evolve, it is often that two types of changes will need to be made: 
1. mappings changes between source schema and EC schema 
2. iModel hierarchy changes of the EC Entities created from source data. 

As we are constantly dealing with changes, it is important to have an easy way to precisely capture these changes and inform downstream iModel.js applications about them. pcf solves this problem by making **DMO** the SSOT of the mappings between source schema and EC schema and making **Node** the SSOT of the hierarchy of mapped EC Entities within the source discipline. 

Sometimes you may want to define and update your own schema (called "dynamic schema" in EC terms) to better represent your source schema in the EC world. With pcf, you no longer need to hand-write a xml EC Schema, it is auto-generated and imported into your iModel if you have defined your own EC classes in **DMO's**. Traditional iModel Connectors keep schema in a separate xml file and embed mapping details across source files.


# Constructs

You will interact with **at most** four pcf constructs:


| Name          | Definition                                                                                                   |
|-------------- | -------------------------------------------------------------------------------------------------------------|
|**PConnector** | A high-customizable [iModel Connector](https://www.itwinjs.org/learning/imodel-connectors/?term=connector) that synchronizes data based on configurations. | 
|**Loader**     | A Loader allows read from a data format. It essentially converts the source data format to the IR Model (intermediate representation model) to be consumed by **PConnector**. |
|**DMO**        | A DMO (Dynamic Mapping Object) defines the mapping between the source schema and the EC schema. |
|**Node**       | A Node represents a unit of synchronization. An iModel is synchronized based on user-defined Nodes and linkages between them. A Node either have a "bisClass" or "dmo" property - Nodes with "dmo" could populate more than one EC Instance (= # of external instances) while Nodes with "bisClass" populate exactly one. |


# Getting started

```console

# 1. install global pcf cli application
npm install -g @itwin/pcf-cli

# 2. initialize a connector template with a name
pcf init <name of your connector>

# 3. add client credentials, iModel ID, and project ID, in App.ts

# 4. compile your typescript code
npm run build

# 5. execute your connector
npm run start

```

Currently, all the documentations and API references of this project are embedded in source files. Use your IDE/language server to look them up through go-to-definitions.


# What you should know

* Nodes
    * The following Entities cannot be deleted from your iModel once created: Partitions, Models.
    * A new Model would be created if you have modified the key of ModelNode.
* Dynamic Schema
    * Only Primitive EC Properties can be added to DMO.classProps.
    * EC Properties defined in DMO.classProps can only be added, not deleted.
* Loaders
    * Currently supported loaders: JSON, XLSX, SQLite Loader.
* Codes
    * Neither itwin-connector-framework nor pcf support Code reuse as of now. (e.g. inserting an element with the same Code as previously deleted element will fail)
* itwin-connector-framework integration 
    * pcf uses itwin-connector-framework under the hood. "fwk" folder is copied from [itwin-connector-framework](https://github.com/imodeljs/imodeljs/tree/master/core/imodel-bridge/src) with a few modifications.

# Advance Topics

## What is the difference between a Connector and a Loader?

One reason that a highly-customizable connector, PConnector, is definitely needed is that it's not possible to have a single connector for a single data format. Data formats could have different schemas that cannot be understood by a single connector. For example, the databases of different users have completely different schemas and importing those data into iModels will always require configurations.

```

Without pcf: data format A == Connector for A => iModel

With pcf:    data format A == Loader for A    => IR Model == parametric connector => iModel 

```

This new architecture separates the concern of accessing an external data from the connector so that we can reuse a connector to populate iModels. It's much easier to write a Loader than to write a full-blown Connector as you don't have to deal with the intricacies in the iModel.js world. It requires zero expertise in iModel.js to write a Loader. As long as there's a **Loader** for a data format, its data can be imported into an iModel through pcf.


## How to write a Loader?

You can write your own Loader by implementing [Loader](https://github.com/zachzhu2016/pcf/blob/main/core/src/loaders/Loader.ts) or extending one of the currently supported Loaders.

# Contributing 

### pre-steps:
```console
# clone pcf repo
git clone https://github.com/iTwin/pcf.git

# install pcf core dependencies
cd core
npm ci 

# build
npm run build
```

### try pcf locally with your connector:
```console
# create global symlink
npm link

# use @itwin/pcf package locally without installing it
cd <your connector project dir>
npm link @itwin/pcf
```

### run pcf unit tests:
```console
npm run test
```

### run pcf integration tests:
```console

# 1. Use your project ID and client ID in https://github.com/iTwin/pcf/blob/main/core/src/test/integration/PConnector.test.ts

# 2. specify test user credentials (cannot use <your-name>@bentley.com)

# on macOS/linux
export imjs_test_regular_user_name="<your test user name>"
export imjs_test_regular_user_password="<your test user password>"

# on windows
set "imjs_test_regular_user_name=<your test user name>"
set "imjs_test_regular_user_password=<your test user password>"

# 3. rebuild
npm run build

# 4. integration tests
npm run test:integration

```

# Road Map

- [ ] handles multiple source files in a single job?
- [ ] update elements in parallel (persist IR model on disk)
- [ ] add a full suite of command line offerings
- [ ] add domain schema service and sync them
- [ ] add support for multiple primary keys in IR Model
- [ ] add wrappers for other programming languages
- [ ] data lineage, add a wrapper around Element classes that records the transformations, maybe useful for iModel exporter
- [ ] dynamically infer the relationship between external entities
- [ ] read large JSON (https://github.com/uhop/stream-json)

# Inspired by

- [Compiler Design](https://en.wikipedia.org/wiki/Compiler)
- [Object-Relational Mapping](https://en.wikipedia.org/wiki/Object%E2%80%93relational_mapping)
- [AWS CDK](https://github.com/aws/aws-cdk)
- [Terraform](https://github.com/hashicorp/terraform)
