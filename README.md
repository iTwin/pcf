[![Build Status](https://dev.azure.com/bentleycs/iModelTechnologies/_apis/build/status/iTwin.pcf?branchName=main)](https://dev.azure.com/bentleycs/iModelTechnologies/_build/latest?definitionId=5431&branchName=main)

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

itwin-pcf is a tool for synchronizing external data with your digital twin, iModel, deterministically and efficiently. As opposed to traditional [iModel Connectors](https://www.itwinjs.org/learning/imodel-connectors/), itwin-pcf allows you to **define** your iModel as code then it takes care of the steps to synchronize it to your desired state. With pcf, you have the full control over how you would like your data to end up in an iModel with minimal programming effort.


# Why use itwin-pcf?


## Declarative Synchronization

pcf allows you to represent your external source data in an iModel using two constructs: **DMO's** and **Nodes** (see definitions below). It makes sure that everything all the EC Entities corresponded to your source data are correctly inserted, updated, and deleted in your iModel. With pcf, you also gain the power to organize [the hierarchy](https://www.itwinjs.org/bis/intro/information-hierarchy/) of your digital twin (iModel) so your end iModel.js applications knows what to expect from your iModels. 


## Minimized Runtime Error & Testing

Given that **DMO** and **Nodes** are the main inputs to your connector, so long as their definitions are correct, each synchronization job is guaranteed to succeed with pcf. 

To minimize runtime errors, your inputs are strictly checked both at compile time and runtime before your synchronization job actually gets executed by pcf (Most errors are caught at compile time by TypeScript interface linting immediately as you type). Functionalities such as code-completion and code-refactoring available in most modern IDE's (e.g Visual Studio Code) will help you to write the correct definitions for them. Since most runtime errors are avoided at compile time and pcf is rigorously tested, you don't have to write any tests for your connector.


## Single Source of Truth (SSOT)

As both of your connector and source data evolve, it is often that two types of changes will need to be made: 
1. mapping changes between the source schema and EC schema. 
2. iModel hierarchy changes of the EC Entities created from the source data. 

As we are constantly dealing with changes, it is important to have an easy way to precisely capture these changes and inform downstream iTwin.js applications about them. pcf solves this problem by making **DMO** the SSOT of the mappings between source schema and EC schema and making **Node** the SSOT of the hierarchy of mapped EC Entities within the source discipline. 

Sometimes you may want to define and update your own schema (called "dynamic schema" in EC terms) to better represent your source schema in the EC world. With pcf, you no longer need to hand-write a xml EC Schema, it is auto-generated and imported into your iModel if you have defined your own EC classes in **DMO's**. Traditional iModel Connectors keep schema in a separate xml file and embed mapping details across source files.

## Lossless Sychronization

When one converts a data format to another, it is likely that not all the properties of the source data are maintained in the target format (lossy transformation). For example, referential-integrity gets lost if a synchronization job skips a database relationship. This has a terrible consequence by allowing the target data to be modified without the relationship constraint. (The best way to prove a synchronization job is correct is by converting the target data back into the source format and see if the data are the same as its original version.) This mistake cannot be avoided at the framework level, the person who's responsible for the mappings between the source and target format must always be extreme cautious in defining mappings. However, the way mappings are presented through DMO in pcf significantly makes the job of this person easier and allows someone without much programming expertise to inspect the mappings.

## Data Integrity

We must not always assume that the source data are normalized or well-modeled. Having an IR Model safe-guards against dirty source data, thus maintaining the data quality in your iModel. IR Model forces every external class to have a primary key and value so that one can always use information stored in the external source to query an iModel and be confident that only a single EC instance gets returned. This is just one kind of optimization. Other kinds of optimizations could also be implemented on IR Model such as dynamically inferring relationships in your data if they're not provided.     


# Constructs

You will interact with mostly three pcf constructs:


| Name          | Definition                                                                                                   |
|-------------- | -------------------------------------------------------------------------------------------------------------|
|**Loader**     | A Loader allows read from a data format. It converts the source data format to an IR Model (intermediate representation model). You can use an existing Loader or write your own. |
|**DMO**        | A DMO (Dynamic Mapping Object) defines the mappings between the IR Model and the EC schema. |
|**Node**       | A Node represents a unit of synchronization and uses DMO. An iModel is synchronized based on user-defined Nodes and linkages between them. |


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
    * The following entity class cannot be deleted from your iModel once created: Subject, Partition, Model.
    * Modifying the key of SubjectNode or ModelNode would cause new Subject, Model, and Partition to be created.
    * Parent-child Modeling is not supported yet. Only the top models and their elements are synchronized.
* Dynamic Schema
    * Only Primitive EC Properties can be added to DMO.ecElement/ecRelationship. They cannot be deleted once added.
* Loaders
    * Loader is persisted as a Repository Link element in your iModel.
    * Currently supported loaders: JSON, XLSX, SQLite Loader.
* Codes
    * Neither itwin-connector-framework nor pcf support Code reuse as of now. (e.g. inserting an element with the same Code as previously deleted element will fail)
* "Too Many Requests"
    * If you saw this message - "Requests are sent too frequent. Sleep for 60 seconds", it means your registered Client ID should probably be upgraded due to rate limiting, otherwise your job will be slowed down with a slight chance of failing. 

# Advance Topics

## What is the difference between a Connector and a Loader?

One reason that a highly-customizable connector, PConnector, is definitely needed is that it's not possible to have a single connector for a single data format. Data formats could have different schemas that cannot be understood by a single connector. For example, the databases of different users have completely different schemas and importing those data into iModels will always require configurations.

```

Without pcf: data source A == Connector for A => iModel

With    pcf: data source A == Loader    for A => IR Model == PConnector => iModel 

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

### Option 1: try pcf locally with your connector:
```console
# create global symlink
npm link

# use @itwin/pcf package locally without installing it
cd <your connector project dir>
npm link @itwin/pcf
```

### Option 2: run pcf unit tests:
```console
npm run test
```

### Option 3: run pcf integration tests:
```console

# 1. specify QA credentials (cannot use <your-name>@bentley.com)

# on macOS/linux
export imjs_test_project_id="<your qa project id>"
export imjs_test_client_id="<your qa app client id>"
export imjs_test_regular_user_name="<your test user name>"
export imjs_test_regular_user_password="<your test user password>"

# on windows
set "imjs_test_project_id=<your qa project id>"
set "imjs_test_client_id=<your qa app client id>"
set "imjs_test_regular_user_name=<your test user name>"
set "imjs_test_regular_user_password=<your test user password>"

# 2. integration tests

# this command creates a test iModel and purges it at the end of the test
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
