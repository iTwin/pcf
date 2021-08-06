
%%{init: {'theme':'base'}}%%
graph LR
    A[(External Data X)] -->|Loader for X| B[(IR Model)]
    B --> C((DMOs))
    B --> D((Nodes))
    subgraph Defined by Users
    C --> E(Connector for X)
    D --> E
    end
    E --> F(PCF Core)
    F --> G[(iModel)]

