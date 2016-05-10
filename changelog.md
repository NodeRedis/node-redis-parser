## v.2.0.0 - 0x May, 2016

The javascript parser got completly rewritten by [Michael Diarmid](https://github.com/Salakar) and [Ruben Bridgewater](https://github.com/BridgeAR) and is now a lot faster than the hiredis parser.
Therefore the hiredis parser was removed and is only used for testing purposes and benchmarking comparison.

All Errors returned by the parser are from now on of class ReplyError

Features

-  Added ReplyError Class
-  Added parser benchmark

Removed

-  Dropped support of hiredis
-  The `stringNumbers` option has been removed in favour of performance
 - Large numbers are automatically stringified so this option is obsolete 
-  The `name` option is "removed"
 -  It is still available for backwards compatibility but it is strongly recommended not to use it

## v.1.3.0 - 27 Mar, 2016

Features

-  Added `auto` as parser name option to check what parser is available
-  Non existing requested parsers falls back into auto mode instead of always choosing the JS parser

## v.1.2.0 - 27 Mar, 2016

Features

-  Added `stringNumbers` option to make sure all numbers are returned as string instead of a js number for precision
-  The parser is from now on going to print warnings if a parser is explicitly requested that does not exist and gracefully chooses the JS parser

## v.1.1.0 - 26 Jan, 2016

Features

-  The parser is from now on going to reset itself on protocol errors
