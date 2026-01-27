## SoftArchitec: Timeline
Detailed timeline (down to the level of modules) on what needs to happen for the implementation of Rev 0 to be complete. Detailed data on who will do what. Full testing/verification does not have to be part of the timeline, but enough testing has to be included to have confidence in Rev 0.

## SoftArchitec: Quality Information
Has all expected information, including likely changes, unlikely changes, secrets of each module (class), relationship between modules, and relationship between modules and SRS (including traceability information). (Module here is understood to be a piece, or unit, of the design. In Parnas's terminology, it is a work assignment for a programmer.) Content is of high quality. Does not have to be documented as a module guide.


## SoftArchitec: Presentation
Good paragraph structure, concise ideas, flow between sections, navigation references, and subsections logically organized. Only one or two spelling and grammar errors. Document easy to navigate. The document includes explicit pointers (links) to relevant documents (SRS, Software Architecture, etc.). Figures are easy to view and easy to zoom in on (pdf is preferred to bitmaps for zooming); hyperlinks are done correctly.



## DetDesDoc: Syntax
The syntax is provided for all modules, including the state variables, environment variables, exported constants, and access programs, or equivalent. As appropriate, the interfaces have the qualities of consistency, essentiality, generality, minimality, high cohesion, low coupling, and opacity. Right level of abstraction (talking about JSON and Python's init syntax is too low-level).


## DetDesDoc: Semantics
The semantics are clear for the access programs for all modules. Consistent notation used.



## DetDesDoc: EnoughToBuild
An independent developer (someone not on the team but with the same programming skills) could implement all of the modules without talking to the team.



## Module Implemented for Another Team
An exceptional effort is made to implement a module for your assigned team. A pull request is created to merge the code and the other team provides review comments. There is no expectation that the merge actually be accepted. We are using the pull request as a means to get feedback on your code. Ideally, this will trigger the CI from the other team, but this isn't required.



## Reflection
Complete and deeply thoughtful reflection addressing the questions in the capTemplate (https://github.com/smiths/capTemplate/blob/main/docs/Design/SoftDetailedDes/MIS.tex). A question is provided to reflect on the experience of implementing another team's module, and of having another team implement your module (if applicable). This reflection is due 5 days after the original deadline.

